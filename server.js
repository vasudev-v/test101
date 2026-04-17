const express = require('express');
const path = require('path');
const db = require('./db')

const app = express();
const PORT = 3000;
const API_KEY = 'peas-and-carrots';

// In-memory data storage
const users = {};
// Structure: { username: { notes: [{ id, content, createdAt }] } }

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const validateUsername = (req, res, next) => {
  const username = req.body.username || req.params.username || req.query.username;
  
  if (!username || username.trim() === '') {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters' });
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }
  
  req.validatedUsername = username.trim();
  next();
};

const validateNoteContent = (req, res, next) => {
  const { content } = req.body;
  
  if (content === undefined || content === null) {
    return res.status(400).json({ error: 'Note content is required' });
  }
  
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Note content must be a string' });
  }
  
  if (content.trim().length === 0) {
    return res.status(400).json({ error: 'Note content cannot be empty' });
  }
  
  if (content.length > 5000) {
    return res.status(400).json({ error: 'Note content cannot exceed 5000 characters' });
  }
  
  next();
};

const validateNoteId = (req, res, next) => {
  const noteId = req.params.noteId || req.body.noteId;
  
  if (!noteId) {
    return res.status(400).json({ error: 'Note ID is required' });
  }
  
  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Note ID must be a number' });
  }
  
  req.validatedNoteId = parseInt(noteId);
  next();
};

// Applies to all /api routes and checks for x-api-key header
app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key. Include x-api-key header.' });
  }

  next();
});

// Routes

app.post('/api/login', validateUsername, async (req, res) => {
  const username = req.validatedUsername;
  
  try {
    // Check if user exists
    const userCheck = await db.query(
      'SELECT id, username, created_at FROM users WHERE username = $1',
      [username]
    );
    
    let userId;
    let isNewUser = false;
    
    if (userCheck.rows.length === 0) {
      // Create new user
      const newUser = await db.query(
        'INSERT INTO users (username) VALUES ($1) RETURNING id, username, created_at',
        [username]
      );
      userId = newUser.rows[0].id;
      isNewUser = true;
      console.log(`New user created: ${username}`);
    } else {
      userId = userCheck.rows[0].id;
      console.log(`User logged in: ${username}`);
    }
    
    // Get note count
    const noteCount = await db.query(
      'SELECT COUNT(*) FROM notes WHERE user_id = $1',
      [userId]
    );
    
    res.json({ 
      success: true, 
      username,
      message: isNewUser ? 'New user created' : 'Welcome back'
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get user's notes
app.get('/api/users/:username/notes', validateUsername, async (req, res) => {
  const username = req.validatedUsername;
  
  try {
    // Get user ID
    const userResult = await db.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    // Get notes
    const notesResult = await db.query(
      `SELECT id, content, created_at as "createdAt", 
              updated_at as "updatedAt" 
       FROM notes 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    
    res.json({ 
      username,
      notes: notesResult.rows
    });
    
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Server error fetching notes' });
  }
});

// Create note
app.post('/api/users/:username/notes', validateUsername, validateNoteContent, async (req, res) => {
  const username = req.validatedUsername;
  const { content } = req.body;
  
  try {
    // Get user ID
    const userResult = await db.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }
    
    const userId = userResult.rows[0].id;
    
    // Create note
    const noteResult = await db.query(
      `INSERT INTO notes (user_id, content) 
       VALUES ($1, $2) 
       RETURNING id, content, created_at as "createdAt"`,
      [userId, content.trim()]
    );
    
    res.status(201).json({ 
      success: true,
      note: noteResult.rows[0]
    });
    
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Server error creating note' });
  }
});

// Update note
app.put('/api/users/:username/notes/:noteId', validateUsername, validateNoteId, validateNoteContent, async (req, res) => {
  const username = req.validatedUsername;
  const noteId = req.validatedNoteId;
  const { content } = req.body;
  
  try {
    // Get user ID and verify note ownership
    const result = await db.query(
      `UPDATE notes 
       SET content = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       AND user_id = (SELECT id FROM users WHERE username = $3)
       RETURNING id, content, created_at as "createdAt", updated_at as "updatedAt"`,
      [content.trim(), noteId, username]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found or unauthorized' });
    }
    
    res.json({ 
      success: true,
      note: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Server error updating note' });
  }
});

// Delete note
app.delete('/api/users/:username/notes/:noteId', validateUsername, validateNoteId, async (req, res) => {
  const username = req.validatedUsername;
  const noteId = req.validatedNoteId;
  const confirm = req.query.confirm; 
  
  if (confirm !== 'true') {
    return res.status(400).json({ error: 'Confirmation required. Add ?confirm=true to the request.' });
  }
  
  try {
    // Delete note with ownership verification
    const result = await db.query(
      `DELETE FROM notes 
       WHERE id = $1 
       AND user_id = (SELECT id FROM users WHERE username = $2)
       RETURNING id, content`,
      [noteId, username]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found or unauthorized' });
    }
    
    res.json({ 
      success: true,
      message: 'Note deleted successfully',
      deletedNote: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Server error deleting note' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

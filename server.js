const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/parking-finder', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Parking Spot Schema
const parkingSpotSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  address: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  availableSpots: { type: Number, default: 1 },
  totalSpots: { type: Number, default: 1 },
  pricePerHour: { type: Number, default: 0 },
  spotType: { type: String, enum: ['street', 'parking_lot', 'private', 'garage'], default: 'street' },
  amenities: [String], // ['covered', 'security', '24/7', 'ev_charging']
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['available', 'full', 'inactive'], default: 'available' },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Booking Schema
const bookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  parkingSpot: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSpot', required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  totalCost: { type: Number, required: true },
  status: { type: String, enum: ['booked', 'active', 'completed', 'cancelled'], default: 'booked' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const ParkingSpot = mongoose.model('ParkingSpot', parkingSpotSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, phone });
    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key');
    res.status(201).json({ token, user: { id: user._id, name, email } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ token, user: { id: user._id, name: user.name, email } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Parking Spot Routes
app.get('/api/parking-spots', async (req, res) => {
  try {
    const { lat, lng, radius = 5 } = req.query;
    let query = {};

    if (lat && lng) {
      // Find spots within radius (simplified distance calculation)
      const latRadius = radius / 111; // rough conversion
      const lngRadius = radius / (111 * Math.cos(lat * Math.PI / 180));
      
      query = {
        latitude: { $gte: parseFloat(lat) - latRadius, $lte: parseFloat(lat) + latRadius },
        longitude: { $gte: parseFloat(lng) - lngRadius, $lte: parseFloat(lng) + lngRadius }
      };
    }

    const spots = await ParkingSpot.find(query)
      .populate('createdBy', 'name phone')
      .sort({ lastUpdated: -1 });
    
    res.json(spots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/parking-spots', authenticateToken, async (req, res) => {
  try {
    const spotData = { ...req.body, createdBy: req.user.userId };
    const spot = new ParkingSpot(spotData);
    await spot.save();
    
    const populatedSpot = await ParkingSpot.findById(spot._id)
      .populate('createdBy', 'name phone');
    
    res.status(201).json(populatedSpot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/parking-spots/:id', authenticateToken, async (req, res) => {
  try {
    const spot = await ParkingSpot.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user.userId },
      { ...req.body, lastUpdated: new Date() },
      { new: true }
    ).populate('createdBy', 'name phone');
    
    if (!spot) {
      return res.status(404).json({ message: 'Spot not found or unauthorized' });
    }
    
    res.json(spot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update spot availability
app.patch('/api/parking-spots/:id/availability', authenticateToken, async (req, res) => {
  try {
    const { availableSpots } = req.body;
    const spot = await ParkingSpot.findByIdAndUpdate(
      req.params.id,
      { 
        availableSpots,
        status: availableSpots > 0 ? 'available' : 'full',
        lastUpdated: new Date()
      },
      { new: true }
    ).populate('createdBy', 'name phone');
    
    res.json(spot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Booking Routes
app.post('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const bookingData = { ...req.body, user: req.user.userId };
    const booking = new Booking(bookingData);
    await booking.save();
    
    // Update available spots
    await ParkingSpot.findByIdAndUpdate(
      req.body.parkingSpot,
      { $inc: { availableSpots: -1 } }
    );
    
    const populatedBooking = await Booking.findById(booking._id)
      .populate('parkingSpot')
      .populate('user', 'name email');
    
    res.status(201).json(populatedBooking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/bookings/my', authenticateToken, async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user.userId })
      .populate('parkingSpot')
      .sort({ createdAt: -1 });
    
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// User's parking spots
app.get('/api/my-spots', authenticateToken, async (req, res) => {
  try {
    const spots = await ParkingSpot.find({ createdBy: req.user.userId })
      .sort({ createdAt: -1 });
    
    res.json(spots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// -------------------
// Middlewares
// -------------------
app.use(cors());
app.use(express.json());

// -------------------
// MongoDB Connection (Optimized for Vercel Serverless)
// -------------------
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    console.log("Using existing MongoDB connection");
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // Disable mongoose buffering
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      family: 4 // Use IPv4, skip trying IPv6
    };

    console.log("Connecting to MongoDB...");
    console.log("MongoDB URI:", process.env.MONGODB_URI ? "Set" : "Not set");
    
    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts)
      .then((mongoose) => {
        console.log("MongoDB connected successfully");
        return mongoose;
      })
      .catch((error) => {
        console.error("MongoDB connection error:", error);
        cached.promise = null;
        throw error;
      });
  }
  
  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
}

// Don't call connectDB at top level for serverless
// connectDB().catch(console.error);

// -------------------
// Schema
// -------------------
const busPositionSchema = new mongoose.Schema(
  {
    bus: {
      type: String,
      required: true,
      unique: true,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function(coords) {
            return coords.length === 2 && 
                   coords[0] >= -180 && coords[0] <= 180 && // lng
                   coords[1] >= -90 && coords[1] <= 90; // lat
          },
          message: "Invalid coordinates"
        }
      },
    },
  },
  { 
    timestamps: true,
    strict: true 
  }
);

// Geo index
busPositionSchema.index({ location: "2dsphere" });

const BusPosition =
  mongoose.models.BusPosition ||
  mongoose.model("BusPosition", busPositionSchema);

// -------------------
// Routes
// -------------------
app.post("/api/bus-positions", async (req, res) => {
  try {
    console.log("Incoming body:", req.body);

    const { busId, lat, lng } = req.body;

    if (!busId || lat == null || lng == null) {
      return res.status(400).json({ 
        message: "Invalid payload. Required: busId, lat, lng" 
      });
    }

    // Validate coordinates
    const latitude = Number(lat);
    const longitude = Number(lng);
    
    if (isNaN(latitude) || isNaN(longitude) ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180) {
      return res.status(400).json({ 
        message: "Invalid coordinates. Lat: -90 to 90, Lng: -180 to 180" 
      });
    }

    // Ensure DB connection
    await connectDB();

    const updatedBus = await BusPosition.findOneAndUpdate(
      { bus: busId },
      {
        bus: busId,
        location: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
      },
      { 
        upsert: true, 
        new: true,
        runValidators: true 
      },
    );

    res.status(200).json({ 
      message: "Position updated",
      data: {
        busId: updatedBus.bus,
        location: updatedBus.location.coordinates
      }
    });
  } catch (err) {
    console.error("ROUTE ERROR:", err);
    
    // Handle MongoDB duplicate key error specifically
    if (err.code === 11000) {
      return res.status(409).json({ message: "Bus ID already exists" });
    }
    
    res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Get all bus positions
app.get("/api/bus-positions", async (req, res) => {
  try {
    await connectDB();
    
    const buses = await BusPosition.find({}, {
      bus: 1,
      location: 1,
      updatedAt: 1
    }).sort({ updatedAt: -1 });
    
    res.json(buses);
  } catch (err) {
    console.error("GET ROUTE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// Get specific bus position
app.get("/api/bus-positions/:busId", async (req, res) => {
  try {
    await connectDB();
    
    const bus = await BusPosition.findOne({ bus: req.params.busId });
    
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }
    
    res.json(bus);
  } catch (err) {
    console.error("GET BUS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await connectDB();
    
    // Check DB connection by running a simple query
    const dbStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
    
    res.json({ 
      status: "Backend running 🚀",
      database: dbStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: "error",
      database: "disconnected",
      message: error.message 
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something broke!" });
});

// -------------------
// EXPORT FOR VERCEL
// -------------------
export default app;

// For local development only - start server
const isLocalDevelopment = process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1';

if (isLocalDevelopment) {
  const PORT = process.env.PORT || 3000;
  
  // Connect to DB before starting server locally
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`🚀 Server running locally on port ${PORT}`);
        console.log(`📝 Test endpoints:`);
        console.log(`   GET  http://localhost:${PORT}/api/health`);
        console.log(`   POST http://localhost:${PORT}/api/bus-positions`);
        console.log(`   GET  http://localhost:${PORT}/api/bus-positions`);
      });
    })
    .catch(err => {
      console.error("Failed to connect to MongoDB:", err);
      process.exit(1);
    });
}
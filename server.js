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
// MongoDB Connection (Serverless Safe)
// -------------------
let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined");
  }

  const db = await mongoose.connect(process.env.MONGODB_URI);
  isConnected = db.connections[0].readyState === 1;
  console.log("MongoDB connected");
};

// -------------------
// Schema
// -------------------
const busPositionSchema = new mongoose.Schema(
  {
    bus: {
      type: String, // 🔥 Use String for GPS simulator
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
        type: [Number], // [lng, lat]
        required: true,
      },
    },
  },
  { timestamps: true }
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
      return res.status(400).json({ message: "Invalid payload" });
    }

    await BusPosition.findOneAndUpdate(
      { bus: busId },
      {
        bus: busId,
        location: {
          type: "Point",
          coordinates: [Number(lng), Number(lat)],
        },
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: "Position updated" });
  } catch (err) {
    console.error("ROUTE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// Optional test route
app.get("/api/health", (req, res) => {
  res.json({ status: "Backend running 🚀" });
});

// -------------------
// EXPORT FOR VERCEL
// -------------------
export default app;
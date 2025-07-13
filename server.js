const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc } = require("firebase/firestore");
require("dotenv").config();

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyBh48b4J2mL4d9cGy8TBFE_3qiZL5NMnMY",
  authDomain: "birthday-fad86.firebaseapp.com",
  projectId: "birthday-fad86",
  storageBucket: "birthday-fad86.appspot.com",
  messagingSenderId: "263994407282",
  appId: "1:263994407282:web:255bb7cf12025dfb3d05eb",
  measurementId: "G-1MCR5CKGJ3",
};

// Firebase init
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Express setup
const app = express();
app.use(express.json());
app.use(cors());

// Razorpay init
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const orderStore = new Map();

// Optimized: Save to Google Sheets (with timeout)
const saveBookingToSheet = async (bookingData) => {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Sheets API timeout'));
    }, 3000); // 3 second timeout

    try {
      const now = new Date();
      const response = await axios.post(
        "https://sheetdb.io/api/v1/s6a0t5omac7jg",
        {
          data: [
            {
              booking_date: bookingData.date,
              booking_time: bookingData.lastItem
                ? `${bookingData.lastItem.start} - ${bookingData.lastItem.end}`
                : "Not Available",
              whatsapp_number: bookingData.whatsapp,
              num_people: bookingData.people,
              decoration: bookingData.wantDecoration ? "Yes" : "No",
              advance_amount: bookingData.advanceAmount,
              remaining_amount: bookingData.remainingAmount,
              total_amount: bookingData.amountWithTax,
              payment_id: bookingData.paymentId,
              extraDecorations: bookingData.extraDecorations,
              address: bookingData.address,
              bookingName: bookingData.bookingName,
              slotType: bookingData.slotType,
              email: bookingData.email,
              payment_status: "Partial (Advance paid)",
              NameUser: bookingData.NameUser,
              PaymentMode: "Online",
              occasion: bookingData.occasion,
              processed_date: now.toLocaleDateString("en-IN"),
              processed_time: now.toLocaleTimeString("en-IN"),
              processed_timestamp: now.toISOString(),
              order_id: bookingData.orderId,
            },
          ],
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 2500, // 2.5 second request timeout
        }
      );

      clearTimeout(timeout);
      console.log("✅ Google Sheet updated");
      resolve(response.data);
    } catch (error) {
      clearTimeout(timeout);
      console.error("❌ Sheet saving error:", error.message);
      reject(error);
    }
  });
};

// Optimized: Save to Firebase (with timeout)
const saveToFirebase = async (bookingData, paymentDetails) => {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Firebase timeout'));
    }, 3000); // 3 second timeout

    try {
      const saveData = {
        ...bookingData,
        selectedTimeSlot: bookingData.lastItem || bookingData.cartData?.[0] || null,
        lastItem: bookingData.lastItem || bookingData.cartData?.[0] || null,
        cartData: bookingData.cartData || [],
        status: "booked",
        paymentId: paymentDetails.razorpay_payment_id,
        orderId: paymentDetails.razorpay_order_id,
        paymentStatus: "partial",
        timestamp: new Date(),
        createdAt: new Date(),
        bookingMeta: {
          createdAt: new Date(),
          source: "web",
          version: "1.0",
          paymentMethod: "razorpay",
        },
      };

      const docRef = await addDoc(collection(db, bookingData.slotType), saveData);
      clearTimeout(timeout);
      console.log("✅ Firebase saved:", docRef.id);
      resolve({ ...saveData, id: docRef.id });
    } catch (error) {
      clearTimeout(timeout);
      console.error("❌ Firebase error:", error.message);
      reject(error);
    }
  });
};

// Signature verification
const verifyPaymentSignature = (order_id, payment_id, signature, secret) => {
  const body = `${order_id}|${payment_id}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return expectedSignature === signature;
};

// Create order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;

    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      notes: {
        customer_name: bookingData?.bookingName || "N/A",
        customer_phone: bookingData?.whatsapp || "N/A",
      },
    };

    const order = await razorpay.orders.create(options);
    orderStore.set(order.id, {
      bookingData,
      amount,
      status: "created",
      createdAt: new Date(),
    });

    res.json(order);
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// OPTIMIZED: Immediate payment verification with parallel processing
app.post("/verify-payment", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // Get order data
    const orderDetails = orderStore.get(razorpay_order_id);
    if (!orderDetails) {
      return res.status(404).json({ 
        status: "failed", 
        message: "Order not found" 
      });
    }

    // Verify signature immediately
    const isSignatureValid = verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET
    );

    if (!isSignatureValid) {
      return res.status(400).json({ 
        status: "failed", 
        message: "Invalid payment signature" 
      });
    }

    // Prepare booking data
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      amountWithTax: orderDetails.bookingData.totalAmount,
    };

    const paymentDetails = {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    };

    // PARALLEL EXECUTION: Save to both Firebase and Sheets simultaneously
    const [firebaseResult, sheetsResult] = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    // Process results
    let savedBooking = null;
    let dataStored = {
      firebase: false,
      sheets: false,
      firebaseError: null,
      sheetsError: null
    };

    if (firebaseResult.status === 'fulfilled') {
      savedBooking = firebaseResult.value;
      dataStored.firebase = true;
      console.log("✅ Firebase save successful");
    } else {
      dataStored.firebaseError = firebaseResult.reason?.message;
      console.error("❌ Firebase save failed:", firebaseResult.reason?.message);
    }

    if (sheetsResult.status === 'fulfilled') {
      dataStored.sheets = true;
      console.log("✅ Sheets save successful");
    } else {
      dataStored.sheetsError = sheetsResult.reason?.message;
      console.error("❌ Sheets save failed:", sheetsResult.reason?.message);
    }

    // Update order status
    orderDetails.status = "paid";
    orderDetails.savedBooking = savedBooking;
    orderDetails.dataStored = dataStored;
    orderStore.set(razorpay_order_id, orderDetails);

    const processingTime = Date.now() - startTime;
    console.log(`⚡ Payment processed in ${processingTime}ms`);

    // Return success even if one storage method fails
    res.json({ 
      status: "success", 
      savedBooking,
      dataStored,
      processingTime: `${processingTime}ms`,
      message: dataStored.firebase || dataStored.sheets 
        ? "Payment verified and data saved successfully" 
        : "Payment verified but data storage had issues"
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error("❌ Verification error:", error);
    res.status(500).json({ 
      status: "failed", 
      message: "Payment verification failed",
      processingTime: `${processingTime}ms`,
      error: error.message 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStore.size 
  });
});

// Webhook (keep for backup verification)
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  // Keep existing webhook code for backup processing
  res.json({ status: "received" });
});

// Periodic cleanup
setInterval(() => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const [orderId, order] of orderStore.entries()) {
    if (order.createdAt < cutoff) {
      orderStore.delete(orderId);
      console.log("🧹 Cleaned up:", orderId);
    }
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
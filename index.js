const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc } = require("firebase/firestore");
const axios = require("axios");
const crypto = require("crypto");
const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
require("dotenv").config();

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBh48b4J2mL4d9cGy8TBFE_3qiZL5NMnMY",
  authDomain: "birthday-fad86.firebaseapp.com",
  projectId: "birthday-fad86",
  storageBucket: "birthday-fad86.firebasestorage.app",
  messagingSenderId: "263994407282",
  appId: "1:263994407282:web:255bb7cf12025dfb3d05eb",
  measurementId: "G-1MCR5CKGJ3"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const app = express();

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:5173', 
    'https://birthday-backend-tau.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  req.requestId = requestId;
  console.log(`[${requestId}] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Environment validation
const validateEnvironment = () => {
  const required = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  console.log('✅ Environment validation passed');
};

validateEnvironment();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Simple order store
const orderStore = new Map();

// Save to Google Sheets
const saveToGoogleSheets = async (bookingData) => {
  try {
    console.log("📝 Saving booking to Google Sheets...");
    
    const now = new Date();
    const currentDate = now.toLocaleDateString("en-IN");
    const currentTime = now.toLocaleTimeString("en-IN");

    const sheetData = {
      booking_date: bookingData.date || '',
      booking_time: bookingData.selectedTimeSlot 
        ? `${bookingData.selectedTimeSlot.start} - ${bookingData.selectedTimeSlot.end}`
        : "Time not specified",
      whatsapp_number: bookingData.whatsapp || '',
      num_people: parseInt(bookingData.people) || 0,
      decoration: bookingData.wantDecoration ? "Yes" : "No",
      advance_amount: 10,
      remaining_amount: (bookingData.totalAmount || 0) - 10,
      total_amount: bookingData.totalAmount || 0,
      payment_id: bookingData.paymentId || '',
      extraDecorations: Array.isArray(bookingData.extraDecorations) 
        ? bookingData.extraDecorations.join(', ') 
        : bookingData.extraDecorations || '',
      address: bookingData.address || '',
      bookingName: bookingData.bookingName || '',
      slotType: bookingData.slotType || '',
      email: bookingData.email || '',
      payment_status: "Partial (Advance paid)",
      NameUser: bookingData.NameUser || bookingData.bookingName || '',
      PaymentMode: "Online",
      occasion: bookingData.occasion || '',
      processed_date: currentDate,
      processed_time: currentTime,
      order_id: bookingData.orderId || '',
      payment_link_id: bookingData.paymentLinkId || '',
      created_at: new Date().toISOString()
    };

    const response = await axios.post(
      "https://sheetdb.io/api/v1/s6a0t5omac7jg",
      { data: [sheetData] },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      }
    );

    console.log("✅ Google Sheets save successful");
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ Google Sheets save failed:", error.message);
    throw error;
  }
};

// Save to Firebase
const saveToFirebase = async (bookingData, paymentDetails) => {
  try {
    console.log("🔥 Saving booking to Firebase...");
    
    const saveData = {
      bookingName: bookingData.bookingName || '',
      NameUser: bookingData.NameUser || bookingData.bookingName || '',
      email: bookingData.email || '',
      address: bookingData.address || '',
      whatsapp: bookingData.whatsapp || '',
      date: bookingData.date || '',
      people: parseInt(bookingData.people) || 0,
      wantDecoration: Boolean(bookingData.wantDecoration),
      occasion: bookingData.occasion || '',
      extraDecorations: Array.isArray(bookingData.extraDecorations) 
        ? bookingData.extraDecorations 
        : [bookingData.extraDecorations].filter(Boolean),
      selectedTimeSlot: bookingData.selectedTimeSlot || {},
      slotType: bookingData.slotType || '',
      status: "booked",
      paymentId: paymentDetails.razorpay_payment_id || '',
      orderId: paymentDetails.razorpay_order_id || '',
      paymentLinkId: paymentDetails.payment_link_id || '',
      paymentStatus: "partial",
      advancePaid: 10,
      remainingAmount: (bookingData.totalAmount || 0) - 10,
      totalAmount: bookingData.totalAmount || 0,
      timestamp: new Date(),
      createdAt: new Date()
    };

    const collectionName = bookingData.slotType || 'bookings';
    const docRef = await addDoc(collection(db, collectionName), saveData);
    
    console.log("✅ Firebase save successful with ID:", docRef.id);
    return { success: true, id: docRef.id, data: saveData };
  } catch (error) {
    console.error("❌ Firebase save failed:", error.message);
    throw error;
  }
};

// Create payment link
app.post("/create-payment-link", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    const { requestId } = req;
    
    console.log(`🔗 [${requestId}] Creating payment link for: ${bookingData?.bookingName}`);
    
    // Validation
    if (!bookingData || !amount) {
      return res.status(400).json({ error: "Missing booking data or amount" });
    }

    if (amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Clean phone number
    const cleanPhone = (bookingData.whatsapp || '').replace(/\D/g, '');
    const phone = cleanPhone.length === 10 ? "91" + cleanPhone : cleanPhone;

    const referenceId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Payment link options
    const options = {
      amount: amount * 100, // Convert to paise
      currency: "INR",
      reference_id: referenceId,
      description: `Theater Booking - ${bookingData.bookingName || 'Customer'}`,
      customer: {
        name: bookingData.bookingName || "Customer",
        email: bookingData.email || "",
        contact: phone || ""
      },
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
      callback_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-success`,
      callback_method: "get",
      notes: {
        booking_name: bookingData.bookingName || '',
        date: bookingData.date || '',
        people: String(bookingData.people || 0),
        amount: String(amount),
        bookingData: JSON.stringify(bookingData)
      }
    };

    console.log(`📞 [${requestId}] Creating Razorpay payment link...`);
    const paymentLink = await razorpay.paymentLink.create(options);
    
    // Store booking data
    const storeData = {
      bookingData,
      amount,
      status: "created",
      paymentLinkId: paymentLink.id,
      referenceId,
      createdAt: new Date()
    };
    
    orderStore.set(paymentLink.id, storeData);

    console.log(`✅ [${requestId}] Payment link created successfully: ${paymentLink.id}`);
    
    res.json({
      success: true,
      paymentLink,
      short_url: paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      referenceId
    });
    
  } catch (error) {
    console.error(`❌ [${req.requestId}] Payment link creation failed:`, error);
    res.status(500).json({ 
      error: "Payment link creation failed",
      details: error.message
    });
  }
});

// Webhook signature verification
const verifyWebhookSignature = (body, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body, 'utf8')
      .digest("hex");
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
};

// Webhook handler
app.post("/webhook", async (req, res) => {
  const { requestId } = req;
  
  try {
    const webhookSignature = req.headers["x-razorpay-signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    console.log(`🔔 [${requestId}] Webhook received`);
    
    if (!webhookSecret || !webhookSignature) {
      return res.status(400).json({ error: "Missing webhook signature or secret" });
    }

    // Verify signature
    const isValidSignature = verifyWebhookSignature(
      req.body,
      webhookSignature,
      webhookSecret
    );

    if (!isValidSignature) {
      console.error(`❌ [${requestId}] Invalid webhook signature`);
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(req.body.toString());
    console.log(`🔔 [${requestId}] Processing event: ${event.event}`);

    if (event.event === "payment_link.paid") {
      await handlePaymentLinkPaid(event.payload.payment_link.entity, event.payload.payment.entity, requestId);
    }
    
    res.json({ success: true, status: "processed" });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Webhook processing failed:`, error);
    res.status(500).json({ error: "Webhook processing failed", message: error.message });
  }
});

// Handle payment link paid
const handlePaymentLinkPaid = async (paymentLinkEntity, paymentEntity, requestId) => {
  try {
    console.log(`🔍 [${requestId}] Processing payment link: ${paymentLinkEntity.id}`);
    
    let orderDetails = orderStore.get(paymentLinkEntity.id);
    
    // If not in store, try to recover from notes
    if (!orderDetails) {
      console.log(`🔄 [${requestId}] Order not found in store, attempting recovery...`);
      
      if (paymentLinkEntity.notes && paymentLinkEntity.notes.bookingData) {
        const recoveredBookingData = JSON.parse(paymentLinkEntity.notes.bookingData);
        orderDetails = {
          bookingData: recoveredBookingData,
          amount: parseFloat(paymentLinkEntity.notes.amount) || 10,
          status: "recovered"
        };
      } else {
        console.error(`❌ [${requestId}] Cannot recover booking data`);
        return;
      }
    }
    
    // Prevent duplicate processing
    if (orderDetails.status === "paid") {
      console.log(`⚠️ [${requestId}] Payment already processed`);
      return;
    }

    console.log(`💰 [${requestId}] Processing payment: ${paymentEntity.id}`);
    
    // Prepare booking data with payment info
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentEntity.id,
      orderId: paymentEntity.order_id,
      paymentLinkId: paymentLinkEntity.id,
      totalAmount: orderDetails.bookingData.totalAmount || 0,
      advanceAmount: orderDetails.amount,
      remainingAmount: (orderDetails.bookingData.totalAmount || 0) - orderDetails.amount
    };

    const paymentDetails = {
      razorpay_payment_id: paymentEntity.id,
      razorpay_order_id: paymentEntity.order_id,
      payment_link_id: paymentLinkEntity.id,
    };

    console.log(`💾 [${requestId}] Saving data to Firebase and Sheets...`);

    // Save to both services
    const savePromises = [
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveToGoogleSheets(bookingDataWithPayment)
    ];

    const results = await Promise.allSettled(savePromises);
    
    const dataStored = {
      firebase: results[0].status === 'fulfilled',
      sheets: results[1].status === 'fulfilled',
      firebaseError: results[0].status === 'rejected' ? results[0].reason.message : null,
      sheetsError: results[1].status === 'rejected' ? results[1].reason.message : null
    };

    console.log(`📊 [${requestId}] Data storage results:`, dataStored);

    // Update order status
    orderStore.set(paymentLinkEntity.id, {
      ...orderDetails,
      status: "paid",
      paymentEntity,
      dataStored,
      processedAt: new Date()
    });
    
    console.log(`✅ [${requestId}] Payment processing completed`);
    
  } catch (error) {
    console.error(`❌ [${requestId}] Payment processing failed:`, error);
  }
};

// Payment status endpoint
app.get("/payment-status/:paymentLinkId", async (req, res) => {
  try {
    const { paymentLinkId } = req.params;
    const orderDetails = orderStore.get(paymentLinkId);
    
    if (!orderDetails) {
      return res.json({ status: 'not_found', message: 'Payment link not found' });
    }
    
    if (orderDetails.status === 'paid') {
      return res.json({
        status: 'paid',
        paymentDetails: orderDetails.paymentEntity,
        dataStored: orderDetails.dataStored,
        bookingData: orderDetails.bookingData
      });
    }
    
    // Try to fetch from Razorpay
    const paymentLink = await razorpay.paymentLink.fetch(paymentLinkId);
    
    res.json({
      status: paymentLink.status,
      amount: paymentLink.amount,
      currency: paymentLink.currency
    });
    
  } catch (error) {
    console.error('Payment status check failed:', error);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    success: true,
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStore.size
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error(`❌ [${req.requestId}] Unhandled error:`, error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Payment Server running on port ${PORT}`);
  console.log(`🔗 Payment Links API: /create-payment-link`);
  console.log(`🔔 Webhook endpoint: /webhook`);
  console.log(`📊 Health check: /health`);
});
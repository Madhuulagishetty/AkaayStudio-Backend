const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc } = require("firebase/firestore");
const axios = require("axios");
const crypto = require("crypto");

const firebaseConfig = {
  apiKey: "AIzaSyBh48b4J2mL4d9cGy8TBFE_3qiZL5NMnMY",
  authDomain: "birthday-fad86.firebaseapp.com",
  projectId: "birthday-fad86",
  storageBucket: "birthday-fad86.firebasestorage.app",
  messagingSenderId: "263994407282",
  appId: "1:263994407282:web:255bb7cf12025dfb3d05eb",
  measurementId: "G-1MCR5CKGJ3",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
require("dotenv").config();

// Environment validation
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error("❌ Missing Razorpay credentials in environment variables");
  process.exit(1);
}

if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
  console.error("❌ Missing Razorpay webhook secret in environment variables");
  process.exit(1);
}

const app = express();

// FIXED CORS Configuration - Allow multiple origins including your deployed frontend
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173', 
  'http://localhost:4173',
  'https://birthday-ui.vercel.app',
  'https://birthday-backend-tau.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

// Raw body parser for webhook
app.use('/webhook', express.raw({ type: 'application/json' }));
// JSON parser for other routes
app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  req.requestId = requestId;
  console.log(`🌐 [${requestId}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Enhanced order store with TTL
const orderStore = new Map();

// FIXED Google Sheets saving with better error handling and logging
const saveBookingToSheet = async (bookingData) => {
  try {
    console.log("📝 Starting Google Sheets save process...");
    console.log("📊 Booking data for sheets:", JSON.stringify(bookingData, null, 2));
    
    const now = new Date();
    const currentDate = now.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const currentTime = now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    const isoTimestamp = now.toISOString();

    const sheetData = {
      booking_date: bookingData.date || '',
      booking_time: bookingData.selectedTimeSlot
        ? `${bookingData.selectedTimeSlot.start} - ${bookingData.selectedTimeSlot.end}`
        : bookingData.lastItem
        ? `${bookingData.lastItem.start} - ${bookingData.lastItem.end}`
        : "Time not specified",
      whatsapp_number: bookingData.whatsapp || '',
      num_people: parseInt(bookingData.people) || 0,
      decoration: bookingData.wantDecoration ? "Yes" : "No",
      advance_amount: parseFloat(bookingData.advanceAmount) || 10,
      remaining_amount: parseFloat(bookingData.remainingAmount) || 0,
      total_amount: parseFloat(bookingData.totalAmount) || 0,
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
      processed_timestamp: isoTimestamp,
      order_id: bookingData.orderId || '',
      payment_link_id: bookingData.paymentLinkId || '',
      source: bookingData.source || 'web_app',
      created_at: bookingData.createdAt || isoTimestamp
    };

    console.log("📊 Sheet data prepared for:", sheetData.bookingName);
    console.log("🔗 Making request to SheetDB API...");

    const response = await axios.post(
      "https://sheetdb.io/api/v1/s6a0t5omac7jg",
      {
        data: [sheetData],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 15000, 
      }
    );

    console.log("✅ Google Sheets save successful:", response.status, response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ Error saving to Google Sheets:");
    console.error("Error message:", error.message);
    console.error("Error response:", error.response?.data);
    console.error("Error status:", error.response?.status);
    throw error;
  }
};

// FIXED Firebase saving with better error handling and logging
const saveToFirebase = async (bookingData, paymentDetails) => {
  try {
    console.log("🔥 Starting Firebase save process...");
    console.log("📊 Booking data for Firebase:", JSON.stringify(bookingData, null, 2));
    
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
      selectedTimeSlot: bookingData.selectedTimeSlot || bookingData.lastItem || bookingData.cartData?.[0] || {},
      lastItem: bookingData.lastItem || bookingData.selectedTimeSlot || bookingData.cartData?.[0] || {},
      cartData: Array.isArray(bookingData.cartData) ? bookingData.cartData : [],
      slotType: bookingData.slotType || '',
      status: "booked",
      paymentId: paymentDetails.razorpay_payment_id || '',
      orderId: paymentDetails.razorpay_order_id || '',
      paymentLinkId: paymentDetails.payment_link_id || '',
      paymentStatus: "partial",
      advancePaid: parseFloat(bookingData.advanceAmount) || 10,
      remainingAmount: parseFloat(bookingData.remainingAmount) || 0,
      totalAmount: parseFloat(bookingData.totalAmount) || 0,
      timestamp: new Date(),
      createdAt: new Date(),
      source: bookingData.source || 'web_app',
      bookingMeta: {
        createdAt: new Date(),
        source: "web",
        version: "2.1",
        paymentMethod: "razorpay_payment_link",
        webhookProcessed: true
      },
    };

    console.log("📊 Firebase data prepared for:", saveData.bookingName);

    const collectionName = bookingData.slotType || 'bookings';
    console.log(`🔥 Saving to Firebase collection: ${collectionName}`);
    
    const docRef = await addDoc(collection(db, collectionName), saveData);
    
    console.log("✅ Firebase save successful with ID:", docRef.id);
    return { success: true, id: docRef.id, data: saveData };
  } catch (error) {
    console.error("❌ Error saving to Firebase:");
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Error stack:", error.stack);
    throw error;
  }
};

// Enhanced phone number validation
const validateAndSanitizePhone = (phone) => {
  if (!phone) return "";
  
  const cleanPhone = phone.toString().replace(/\D/g, '');
  const hasRecurringDigits = /^(\d)\1{9,}$/.test(cleanPhone);
  
  if (cleanPhone.length < 10 || cleanPhone.length > 12 || hasRecurringDigits) {
    console.log(`⚠️ Invalid phone number: ${cleanPhone}`);
    return "";
  }
  
  return cleanPhone.length === 10 ? "91" + cleanPhone : cleanPhone;
};

// Enhanced payment link creation with better data storage in notes
app.post("/create-payment-link", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    const { requestId } = req;
    
    console.log(`🔗 [${requestId}] Creating payment link for: ${bookingData?.bookingName}`);
    console.log(`💰 [${requestId}] Amount: ₹${amount}`);

    if (!bookingData || !amount) {
      return res.status(400).json({ error: "Missing booking data or amount" });
    }

    if (amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const sanitizedPhone = validateAndSanitizePhone(bookingData.whatsapp);
    const referenceId = "booking_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    
    const options = {
      amount: amount * 100, // Convert to paise
      currency: "INR",
      reference_id: referenceId,
      description: `Theater Booking - ${bookingData.bookingName || 'Customer'} (${bookingData.date || 'Date TBD'})`,
      customer: {
        name: bookingData.bookingName || "Customer",
        email: bookingData.email || "",
      },
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
      callback_url: `https://birthday-ui.vercel.app/payment-success`,
      callback_method: "get",
      notes: {
        booking_name: (bookingData.bookingName || '').substring(0, 50),
        date: (bookingData.date || '').substring(0, 20),
        people: String(bookingData.people || 0),
        amount: String(amount),
        reference_id: referenceId,
        // Store complete booking data in notes for recovery
        bookingData: JSON.stringify(bookingData)
      }
    };

    // Add phone only if valid
    if (sanitizedPhone) {
      options.customer.contact = sanitizedPhone;
    }

    console.log(`📞 [${requestId}] Creating Razorpay payment link...`);
    const paymentLink = await razorpay.paymentLink.create(options);
    
    // Store enhanced booking data
    const enhancedBookingData = {
      ...bookingData,
      totalAmount: bookingData.totalAmount || bookingData.amountWithTax,
      advanceAmount: amount,
      remainingAmount: (bookingData.totalAmount || bookingData.amountWithTax) - amount,
      source: 'web_app',
      createdAt: new Date().toISOString(),
      reference_id: referenceId,
      paymentLinkId: paymentLink.id
    };

    orderStore.set(paymentLink.id, {
      bookingData: enhancedBookingData,
      amount,
      status: "created",
      type: "payment_link",
      createdAt: new Date(),
      reference_id: referenceId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    console.log(`✅ [${requestId}] Payment link created: ${paymentLink.id}`);
    
    res.json({
      success: true,
      paymentLink,
      short_url: paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      referenceId: referenceId,
    });
  } catch (error) {
    console.error(`❌ [${req.requestId}] Payment link creation failed:`, error);
    res.status(500).json({ 
      error: "Payment link creation failed",
      details: error.message,
      code: 'PAYMENT_LINK_CREATION_FAILED'
    });
  }
});

// Enhanced webhook signature verification
const verifyWebhookSignature = (body, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
  } catch (error) {
    console.error("❌ Signature verification error:", error);
    return false;
  }
};

// FIXED webhook handler with better logging and error handling
app.post("/webhook", async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  try {
    const webhookSignature = req.headers["x-razorpay-signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    console.log(`🔔 [${requestId}] Webhook received at ${new Date().toISOString()}`);
    console.log(`🔔 [${requestId}] Headers:`, req.headers);
    
    if (!webhookSecret) {
      console.error(`❌ [${requestId}] Webhook secret not configured`);
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!webhookSignature) {
      console.error(`❌ [${requestId}] Missing webhook signature`);
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    // Verify webhook signature
    const isValidSignature = verifyWebhookSignature(
      req.body,
      webhookSignature,
      webhookSecret
    );

    if (!isValidSignature) {
      console.error(`❌ [${requestId}] Invalid webhook signature`);
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(req.body);
    console.log(`🔔 [${requestId}] Event: ${event.event}`);
    console.log(`🔔 [${requestId}] Event payload:`, JSON.stringify(event, null, 2));

    // Handle different event types
    switch (event.event) {
      case "payment_link.paid":
        await handlePaymentLinkPaid(event.payload.payment_link.entity, event.payload.payment.entity, requestId);
        break;
        
      case "payment.captured":
        await handlePaymentCaptured(event.payload.payment.entity, requestId);
        break;
        
      case "payment.failed":
        await handlePaymentFailed(event.payload.payment.entity, requestId);
        break;
        
      default:
        console.log(`ℹ️ [${requestId}] Ignored event: ${event.event}`);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ [${requestId}] Webhook processed in ${processingTime}ms`);
    
    res.json({ 
      success: true,
      status: "processed", 
      processingTime: `${processingTime}ms`,
      requestId 
    });
  } catch (error) {
    console.error(`❌ [${requestId}] Webhook error:`, error);
    res.status(500).json({ 
      error: "Webhook processing failed", 
      message: error.message,
      requestId 
    });
  }
});

// FIXED payment link handler with better data recovery and saving
const handlePaymentLinkPaid = async (paymentLinkEntity, paymentEntity, requestId) => {
  try {
    console.log(`🔍 [${requestId}] Processing payment link: ${paymentLinkEntity.id}`);
    
    let orderDetails = orderStore.get(paymentLinkEntity.id);
    
    if (!orderDetails) {
      console.error(`❌ [${requestId}] Payment link data not found: ${paymentLinkEntity.id}`);
      console.log(`📋 [${requestId}] Available IDs:`, Array.from(orderStore.keys()));
      
      // Try to recover from Razorpay notes
      if (paymentLinkEntity.notes && paymentLinkEntity.notes.bookingData) {
        console.log(`🔄 [${requestId}] Recovering booking data from notes...`);
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
      console.log(`⚠️ [${requestId}] Payment already processed: ${paymentLinkEntity.id}`);
      return;
    }

    console.log(`💰 [${requestId}] Processing payment: ${paymentEntity.id}`);
    
    // Prepare enhanced booking data
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentEntity.id,
      orderId: paymentEntity.order_id,
      paymentLinkId: paymentLinkEntity.id,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      totalAmount: orderDetails.bookingData.totalAmount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId
    };

    const paymentDetails = {
      razorpay_payment_id: paymentEntity.id,
      razorpay_order_id: paymentEntity.order_id,
      payment_link_id: paymentLinkEntity.id,
    };

    console.log(`💾 [${requestId}] Saving data to Firebase and Sheets...`);

    // Save to both services with enhanced error handling
    const savePromises = [
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ];

    const results = await Promise.allSettled(savePromises);

    // Log detailed results
    const dataStored = {
      firebase: results[0].status === 'fulfilled',
      sheets: results[1].status === 'fulfilled',
      firebaseError: results[0].status === 'rejected' ? results[0].reason?.message : null,
      sheetsError: results[1].status === 'rejected' ? results[1].reason?.message : null,
      firebaseData: results[0].status === 'fulfilled' ? results[0].value : null,
      sheetsData: results[1].status === 'fulfilled' ? results[1].value : null,
      timestamp: new Date().toISOString()
    };

    console.log(`📊 [${requestId}] Data storage results:`, {
      firebase: dataStored.firebase,
      sheets: dataStored.sheets,
      errors: {
        firebase: dataStored.firebaseError,
        sheets: dataStored.sheetsError
      }
    });

    // Update order status
    orderStore.set(paymentLinkEntity.id, {
      ...orderDetails,
      status: "paid",
      paymentEntity: paymentEntity,
      dataStored: dataStored,
      savedBooking: dataStored.firebaseData,
      processedAt: new Date().toISOString(),
      webhookRequestId: requestId
    });
    
    console.log(`✅ [${requestId}] Payment link processed successfully`);
  } catch (error) {
    console.error(`❌ [${requestId}] Payment link processing failed:`, error);
    
    // Update order with error status
    const orderDetails = orderStore.get(paymentLinkEntity.id);
    if (orderDetails) {
      orderStore.set(paymentLinkEntity.id, {
        ...orderDetails,
        status: "error",
        error: error.message,
        errorAt: new Date().toISOString()
      });
    }
  }
};

// Enhanced regular payment handler
const handlePaymentCaptured = async (paymentEntity, requestId) => {
  try {
    const orderId = paymentEntity.order_id;
    const paymentId = paymentEntity.id;
    const orderDetails = orderStore.get(orderId);
    
    if (!orderDetails) {
      console.log(`⚠️ [${requestId}] Order data not found: ${orderId}`);
      return;
    }
    
    console.log(`💰 [${requestId}] Processing regular payment: ${paymentId}`);
    
    // Similar processing logic as payment link
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentId,
      orderId: orderId,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      totalAmount: orderDetails.bookingData.totalAmount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId
    };

    const paymentDetails = {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      razorpay_signature: "webhook_verified",
    };

    // Save to both services
    const results = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    // Update order status
    orderStore.set(orderId, {
      ...orderDetails,
      status: "paid",
      paymentId: paymentId,
      dataStored: {
        firebase: results[0].status === 'fulfilled',
        sheets: results[1].status === 'fulfilled',
        firebaseError: results[0].status === 'rejected' ? results[0].reason?.message : null,
        sheetsError: results[1].status === 'rejected' ? results[1].reason?.message : null,
        timestamp: new Date().toISOString()
      },
      savedBooking: results[0].status === 'fulfilled' ? results[0].value : null,
      processedAt: new Date().toISOString()
    });

    console.log(`✅ [${requestId}] Regular payment processed: ${paymentId}`);
  } catch (error) {
    console.error(`❌ [${requestId}] Regular payment processing failed:`, error);
  }
};

// Enhanced payment failure handler
const handlePaymentFailed = async (paymentEntity, requestId) => {
  try {
    const orderId = paymentEntity.order_id;
    console.log(`❌ [${requestId}] Payment failed:`, { orderId, paymentId: paymentEntity.id });

    const orderDetails = orderStore.get(orderId);
    if (orderDetails) {
      orderStore.set(orderId, {
        ...orderDetails,
        status: "failed",
        error: "Payment failed",
        failedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ [${requestId}] Payment failure handling error:`, error);
  }
};

// FIXED payment status endpoint with better recovery
app.get("/payment-status/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`🔍 Checking payment status: ${paymentId}`);
    
    // Check local store first
    const orderDetails = orderStore.get(paymentId);
    
    if (orderDetails) {
      console.log(`📊 Order details found:`, {
        status: orderDetails.status,
        type: orderDetails.type,
        dataStored: orderDetails.dataStored
      });
      
      if (orderDetails.status === "paid") {
        return res.json({
          status: "paid",
          bookingData: orderDetails.savedBooking?.data || orderDetails.savedBooking,
          paymentDetails: orderDetails.paymentEntity,
          dataStored: orderDetails.dataStored,
          type: orderDetails.type || "order",
          processedAt: orderDetails.processedAt
        });
      }
    }
    
    // For payment links, check with Razorpay API
    if (paymentId.startsWith('plink_')) {
      try {
        console.log(`🔍 Checking payment link status with Razorpay API...`);
        const paymentLink = await razorpay.paymentLink.fetch(paymentId);
        
        if (paymentLink.status === "paid") {
          console.log(`✅ Payment link is paid but not processed locally`);
          
          // Try to process the payment immediately
          try {
            const payments = await razorpay.payments.all({
              'payment_link_id': paymentId
            });
            
            if (payments.items.length > 0) {
              const payment = payments.items[0];
              console.log(`🔄 Found payment to process: ${payment.id}`);
              
              // Process immediately
              await handlePaymentLinkPaid(paymentLink, payment, 'status_check');
              
              // Check if it was processed successfully
              const updatedOrderDetails = orderStore.get(paymentId);
              if (updatedOrderDetails && updatedOrderDetails.status === "paid") {
                return res.json({
                  status: "paid",
                  bookingData: updatedOrderDetails.savedBooking?.data || updatedOrderDetails.savedBooking,
                  paymentDetails: updatedOrderDetails.paymentEntity,
                  dataStored: updatedOrderDetails.dataStored,
                  type: "payment_link",
                  processedAt: updatedOrderDetails.processedAt
                });
              }
            }
          } catch (processError) {
            console.error(`❌ Error processing payment during status check:`, processError);
          }
          
          return res.json({
            status: "paid",
            razorpayStatus: paymentLink.status,
            needsRecovery: !orderDetails,
            type: "payment_link",
          });
        } else {
          console.log(`⏳ Payment link status: ${paymentLink.status}`);
          return res.json({
            status: paymentLink.status,
            razorpayStatus: paymentLink.status,
            type: "payment_link",
          });
        }
      } catch (apiError) {
        console.error(`❌ Razorpay API error:`, apiError);
        return res.json({
          status: "unknown",
          error: "Could not verify payment status",
        });
      }
    }
    
    // For regular orders
    if (orderDetails) {
      res.json({
        status: orderDetails.status,
        bookingData: orderDetails.savedBooking?.data || orderDetails.savedBooking,
        message: orderDetails.status === "failed" ? orderDetails.error : `Payment ${orderDetails.status}`,
        type: "order",
        dataStored: orderDetails.dataStored
      });
    } else {
      res.status(404).json({
        status: "not_found",
        message: "Order not found",
      });
    }
  } catch (error) {
    console.error("❌ Payment status check failed:", error);
    res.status(500).json({ error: "Status check failed", details: error.message });
  }
});

// FIXED payment recovery endpoint with immediate data saving
app.post("/recover-payment", async (req, res) => {
  try {
    const { paymentLinkId, bookingData } = req.body;
    
    if (!paymentLinkId) {
      return res.status(400).json({ error: "Payment link ID required" });
    }
    
    console.log(`🔄 Starting payment recovery for: ${paymentLinkId}`);
    
    // Check payment link status with Razorpay
    const paymentLink = await razorpay.paymentLink.fetch(paymentLinkId);
    
    if (paymentLink.status === "paid") {
      // Get payments for this payment link
      const payments = await razorpay.payments.all({
        'payment_link_id': paymentLinkId
      });
      
      if (payments.items.length > 0) {
        const payment = payments.items[0];
        
        console.log(`🔄 Found payment to recover: ${payment.id}`);
        
        // Process the payment manually
        const bookingDataWithPayment = {
          ...bookingData,
          paymentId: payment.id,
          orderId: payment.order_id,
          paymentLinkId: paymentLinkId,
          advanceAmount: 10,
          remainingAmount: bookingData.totalAmount - 10,
          totalAmount: bookingData.totalAmount,
          recoveredAt: new Date().toISOString(),
          source: 'recovery_process'
        };

        const paymentDetails = {
          razorpay_payment_id: payment.id,
          razorpay_order_id: payment.order_id,
          payment_link_id: paymentLinkId,
        };

        // Save to both services
        const results = await Promise.allSettled([
          saveToFirebase(bookingDataWithPayment, paymentDetails),
          saveBookingToSheet(bookingDataWithPayment)
        ]);
        
        const dataStored = {
          firebase: results[0].status === 'fulfilled',
          sheets: results[1].status === 'fulfilled',
          firebaseError: results[0].status === 'rejected' ? results[0].reason?.message : null,
          sheetsError: results[1].status === 'rejected' ? results[1].reason?.message : null,
          timestamp: new Date().toISOString()
        };

        console.log(`✅ Payment recovery completed:`, dataStored);
        
        res.json({
          status: "recovered",
          paymentId: payment.id,
          dataStored: dataStored,
          bookingData: results[0].status === 'fulfilled' ? results[0].value : null
        });
      } else {
        console.log(`⚠️ No payments found for payment link: ${paymentLinkId}`);
        res.json({ status: "no_payment_found" });
      }
    } else {
      console.log(`⚠️ Payment link not paid: ${paymentLink.status}`);
      res.json({ 
        status: "not_paid",
        paymentLinkStatus: paymentLink.status 
      });
    }
  } catch (error) {
    console.error("❌ Payment recovery failed:", error);
    res.status(500).json({ 
      error: "Recovery failed", 
      details: error.message 
    });
  }
});

// NEW: Manual data save endpoint for testing
app.post("/manual-save", async (req, res) => {
  try {
    const { bookingData, paymentDetails } = req.body;
    
    console.log("🔧 Manual save requested");
    console.log("📊 Booking data:", JSON.stringify(bookingData, null, 2));
    console.log("💳 Payment details:", JSON.stringify(paymentDetails, null, 2));
    
    // Save to both services
    const results = await Promise.allSettled([
      saveToFirebase(bookingData, paymentDetails),
      saveBookingToSheet(bookingData)
    ]);
    
    const dataStored = {
      firebase: results[0].status === 'fulfilled',
      sheets: results[1].status === 'fulfilled',
      firebaseError: results[0].status === 'rejected' ? results[0].reason?.message : null,
      sheetsError: results[1].status === 'rejected' ? results[1].reason?.message : null,
      firebaseData: results[0].status === 'fulfilled' ? results[0].value : null,
      sheetsData: results[1].status === 'fulfilled' ? results[1].value : null,
      timestamp: new Date().toISOString()
    };
    
    console.log("✅ Manual save completed:", dataStored);
    
    res.json({
      success: true,
      dataStored: dataStored
    });
  } catch (error) {
    console.error("❌ Manual save failed:", error);
    res.status(500).json({ 
      error: "Manual save failed", 
      details: error.message 
    });
  }
});

// Enhanced cleanup with TTL
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;

  for (const [id, orderDetails] of orderStore.entries()) {
    const shouldClean = orderDetails.expiresAt && now > orderDetails.expiresAt;
    
    if (shouldClean) {
      // Only clean if not recently paid (keep paid orders for 2 hours for recovery)
      if (orderDetails.status !== "paid" || (now - new Date(orderDetails.processedAt || 0)) > 2 * 60 * 60 * 1000) {
        orderStore.delete(id);
        cleanedCount++;
      }
    }
  }

  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired orders (${orderStore.size} remaining)`);
  }
}, 60 * 60 * 1000); // Run every hour

// Health check endpoint
app.get("/health", (req, res) => {
  const orderStats = {
    total: orderStore.size,
    paid: 0,
    processing: 0,
    failed: 0,
    created: 0
  };

  for (const [_, order] of orderStore.entries()) {
    orderStats[order.status] = (orderStats[order.status] || 0) + 1;
  }

  res.json({ 
    success: true,
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStats,
    version: "2.1 - CORS Fixed Payment System",
    environment: process.env.NODE_ENV || 'development',
    allowedOrigins: allowedOrigins
  });
});

// Debug endpoint for development
if (process.env.NODE_ENV === 'development') {
  app.get("/debug/orders", (req, res) => {
    const orders = Array.from(orderStore.entries()).map(([id, order]) => ({
      id,
      status: order.status,
      type: order.type,
      createdAt: order.createdAt,
      dataStored: order.dataStored
    }));
    
    res.json({ orders, count: orders.length });
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(`❌ [${req.requestId}] Unhandled error:`, error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    requestId: req.requestId,
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 CORS Fixed Payment System Server running on port ${PORT}`);
  console.log(`📡 Version: 2.1 - CORS Fixed`);
  console.log(`🌐 Allowed Origins:`, allowedOrigins);
  console.log(`🔗 Payment Links API: /create-payment-link`);
  console.log(`🔔 Webhook endpoint: /webhook`);
  console.log(`🔄 Recovery endpoint: /recover-payment`);
  console.log(`🔧 Manual save endpoint: /manual-save`);
  console.log(`📊 Health check: /health`);
});
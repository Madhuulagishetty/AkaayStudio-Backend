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

// Enhanced retry utility with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000, context = "operation") => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`❌ ${context} attempt ${i + 1}/${maxRetries} failed:`, error.message);
      
      if (i === maxRetries - 1) {
        console.error(`❌ ${context} failed after ${maxRetries} attempts`);
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
      console.log(`🔄 ${context} retry ${i + 1} in ${delay.toFixed(0)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Environment validation
const validateEnvironment = () => {
  const required = [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  console.log('✅ Environment validation passed');
};

validateEnvironment();

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || [
    'http://localhost:3000', 
    'http://localhost:5173', 
    'http://localhost:4173',
    'https://birthday-backend-tau.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Enhanced middleware setup
app.use('/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '10mb' }));

// Enhanced logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  req.requestId = requestId;
  req.startTime = startTime;
  
  console.log(`🌐 [${requestId}] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`📊 [${requestId}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Enhanced order store with TTL and metadata
const orderStore = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const addToOrderStore = (id, data) => {
  const enhancedData = {
    ...data,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + CACHE_TTL),
    attempts: 0,
    lastUpdated: new Date()
  };
  
  orderStore.set(id, enhancedData);
  console.log(`📦 Added to order store: ${id} (${orderStore.size} total)`);
};

const updateOrderStore = (id, updates) => {
  const existing = orderStore.get(id);
  if (existing) {
    const updated = {
      ...existing,
      ...updates,
      lastUpdated: new Date()
    };
    orderStore.set(id, updated);
    console.log(`🔄 Updated order store: ${id}`);
  }
};

// Enhanced Google Sheets saving with better error handling
const saveBookingToSheet = async (bookingData) => {
  return retryWithBackoff(async () => {
    console.log("📝 Saving booking to Google Sheets...");
    
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

    // Enhanced sheet data with validation
    const sheetData = {
      booking_date: String(bookingData.date || ''),
      booking_time: bookingData.lastItem
        ? `${bookingData.lastItem.start} - ${bookingData.lastItem.end}`
        : bookingData.selectedTimeSlot
        ? `${bookingData.selectedTimeSlot.start} - ${bookingData.selectedTimeSlot.end}`
        : "Time not specified",
      whatsapp_number: String(bookingData.whatsapp || ''),
      num_people: parseInt(bookingData.people) || 0,
      decoration: bookingData.wantDecoration ? "Yes" : "No",
      advance_amount: parseFloat(bookingData.advanceAmount) || 10,
      remaining_amount: parseFloat(bookingData.remainingAmount) || 0,
      total_amount: parseFloat(bookingData.totalAmount) || 0,
      payment_id: String(bookingData.paymentId || ''),
      extraDecorations: Array.isArray(bookingData.extraDecorations) 
        ? bookingData.extraDecorations.join(', ') 
        : String(bookingData.extraDecorations || ''),
      address: String(bookingData.address || ''),
      bookingName: String(bookingData.bookingName || ''),
      slotType: String(bookingData.slotType || ''),
      email: String(bookingData.email || ''),
      payment_status: "Partial (Advance paid)",
      NameUser: String(bookingData.NameUser || bookingData.bookingName || ''),
      PaymentMode: "Online",
      occasion: String(bookingData.occasion || ''),
      processed_date: currentDate,
      processed_time: currentTime,
      processed_timestamp: isoTimestamp,
      order_id: String(bookingData.orderId || ''),
      payment_link_id: String(bookingData.paymentLinkId || ''),
      source: String(bookingData.source || 'web_app'),
      created_at: bookingData.createdAt || isoTimestamp,
      session_id: String(bookingData.sessionId || ''),
      webhook_processed: bookingData.webhookProcessed || false,
      data_integrity_check: 'passed'
    };

    console.log("📊 Sheet data prepared for:", sheetData.bookingName);

    const response = await axios.post(
      "https://sheetdb.io/api/v1/s6a0t5omac7jg",
      {
        data: [sheetData],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    console.log("✅ Google Sheets save successful:", response.data);
    return { success: true, sheetData, response: response.data };
    
  }, 4, 2000, "Google Sheets save");
};

// Enhanced Firebase saving with better error handling
const saveToFirebase = async (bookingData, paymentDetails) => {
  return retryWithBackoff(async () => {
    console.log("🔥 Saving booking to Firebase...");
    
    // Enhanced save data with validation
    const saveData = {
      bookingName: String(bookingData.bookingName || ''),
      NameUser: String(bookingData.NameUser || bookingData.bookingName || ''),
      email: String(bookingData.email || ''),
      address: String(bookingData.address || ''),
      whatsapp: String(bookingData.whatsapp || ''),
      date: String(bookingData.date || ''),
      people: parseInt(bookingData.people) || 0,
      wantDecoration: Boolean(bookingData.wantDecoration),
      occasion: String(bookingData.occasion || ''),
      extraDecorations: Array.isArray(bookingData.extraDecorations) 
        ? bookingData.extraDecorations 
        : [bookingData.extraDecorations].filter(Boolean),
      selectedTimeSlot: bookingData.lastItem || bookingData.selectedTimeSlot || bookingData.cartData?.[0] || {},
      lastItem: bookingData.lastItem || bookingData.selectedTimeSlot || bookingData.cartData?.[0] || {},
      cartData: Array.isArray(bookingData.cartData) ? bookingData.cartData : [],
      slotType: String(bookingData.slotType || ''),
      status: "booked",
      paymentId: String(paymentDetails.razorpay_payment_id || ''),
      orderId: String(paymentDetails.razorpay_order_id || ''),
      paymentLinkId: String(paymentDetails.payment_link_id || ''),
      paymentStatus: "partial",
      advancePaid: parseFloat(bookingData.advanceAmount) || 10,
      remainingAmount: parseFloat(bookingData.remainingAmount) || 0,
      totalAmount: parseFloat(bookingData.totalAmount) || 0,
      timestamp: new Date(),
      createdAt: new Date(),
      source: String(bookingData.source || 'web_app'),
      sessionId: String(bookingData.sessionId || ''),
      webhookProcessed: Boolean(bookingData.webhookProcessed),
      dataIntegrityCheck: 'passed',
      bookingMeta: {
        createdAt: new Date(),
        source: "web",
        version: "3.0",
        paymentMethod: "razorpay_payment_link",
        webhookProcessed: Boolean(bookingData.webhookProcessed),
        recoveryAttempts: bookingData.recoveryAttempts || 0
      },
    };

    console.log("📊 Firebase data prepared for:", saveData.bookingName);

    const collectionName = bookingData.slotType || 'bookings';
    const docRef = await addDoc(collection(db, collectionName), saveData);
    
    console.log("✅ Firebase save successful with ID:", docRef.id);
    return { ...saveData, id: docRef.id, success: true };
    
  }, 4, 1500, "Firebase save");
};

// Enhanced phone number validation
const validateAndSanitizePhone = (phone) => {
  if (!phone) return "";
  
  const cleanPhone = phone.toString().replace(/\D/g, '');
  const hasRecurringDigits = /^(\d)\1{9,}$/.test(cleanPhone);
  
  if (cleanPhone.length < 10 || cleanPhone.length > 12 || hasRecurringDigits) {
    console.log(`⚠️ Invalid phone number format: ${cleanPhone}`);
    return "";
  }
  
  return cleanPhone.length === 10 ? "91" + cleanPhone : cleanPhone;
};

// Enhanced payment link creation with better validation
app.post("/create-payment-link", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    const { requestId } = req;
    
    console.log(`🔗 [${requestId}] Creating payment link for:`, bookingData?.bookingName);
    
    // Enhanced validation
    if (!bookingData || !amount) {
      console.error(`❌ [${requestId}] Missing required data`);
      return res.status(400).json({ error: "Missing booking data or amount" });
    }

    if (amount <= 0 || amount > 10000) {
      console.error(`❌ [${requestId}] Invalid amount: ${amount}`);
      return res.status(400).json({ error: "Invalid amount" });
    }

    const sanitizedPhone = validateAndSanitizePhone(bookingData.whatsapp);
    const referenceId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sessionId = bookingData.sessionId || Date.now().toString();
    
    // Enhanced payment link options
    const options = {
      amount: amount * 10, // Convert to paise
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
      callback_url: `${process.env.FRONTEND_URL || 'https://birthday-backend-tau.vercel.app'}/payment-success`,
      callback_method: "get",
      notes: {
        booking_name: (bookingData.bookingName || '').substring(0, 50),
        session_id: sessionId,
        reference_id: referenceId,
        date: (bookingData.date || '').substring(0, 20),
        people: String(bookingData.people || 0),
        amount: String(amount),
        version: "3.0"
      }
    };

    // Add phone only if valid
    if (sanitizedPhone) {
      options.customer.contact = sanitizedPhone;
    }

    console.log(`📞 [${requestId}] Creating Razorpay payment link...`);
    const paymentLink = await razorpay.paymentLink.create(options);
    
    // Enhanced booking data for storage
    const enhancedBookingData = {
      ...bookingData,
      totalAmount: bookingData.totalAmount || bookingData.amountWithTax,
      advanceAmount: amount,
      remainingAmount: (bookingData.totalAmount || bookingData.amountWithTax) - amount,
      source: 'web_app_v3',
      createdAt: new Date().toISOString(),
      reference_id: referenceId,
      sessionId,
      paymentLinkId: paymentLink.id,
      webhookProcessed: false,
      dataIntegrityCheck: 'initialized'
    };

    // Store in enhanced order store
    addToOrderStore(paymentLink.id, {
      bookingData: enhancedBookingData,
      amount,
      status: "created",
      type: "payment_link",
      reference_id: referenceId,
      sessionId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdBy: 'payment_link_api',
      version: '3.0'
    });

    console.log(`✅ [${requestId}] Payment link created successfully: ${paymentLink.id}`);
    
    res.json({
      success: true,
      paymentLink,
      short_url: paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      referenceId: referenceId,
      sessionId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    
  } catch (error) {
    console.error(`❌ [${req.requestId}] Payment link creation failed:`, error);
    res.status(500).json({ 
      error: "Payment link creation failed",
      details: error.message,
      code: error.code || 'PAYMENT_LINK_CREATION_FAILED'
    });
  }
});

// Enhanced webhook signature verification
const verifyWebhookSignature = (body, signature, secret) => {
  try {
    console.log("🔐 Verifying webhook signature...");
    
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body, 'utf8')
      .digest("hex");
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
    
    console.log(`🔐 Signature verification: ${isValid ? 'VALID' : 'INVALID'}`);
    return isValid;
    
  } catch (error) {
    console.error("❌ Signature verification error:", error);
    return false;
  }
};

// Enhanced webhook handler with better error handling
app.post("/webhook", async (req, res) => {
  const { requestId, startTime } = req;
  
  try {
    const webhookSignature = req.headers["x-razorpay-signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    console.log(`🔔 [${requestId}] Webhook received`);
    
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

    const event = JSON.parse(req.body.toString());
    console.log(`🔔 [${requestId}] Processing event: ${event.event}`);

    // Enhanced event handling
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
        
      case "payment_link.cancelled":
        await handlePaymentLinkCancelled(event.payload.payment_link.entity, requestId);
        break;
        
      default:
        console.log(`ℹ️ [${requestId}] Event ignored: ${event.event}`);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ [${requestId}] Webhook processed successfully in ${processingTime}ms`);
    
    res.json({ 
      success: true,
      status: "processed", 
      processingTime: `${processingTime}ms`,
      requestId,
      event: event.event
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Webhook processing failed:`, error);
    res.status(500).json({ 
      error: "Webhook processing failed", 
      message: error.message,
      requestId,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Enhanced payment link paid handler
const handlePaymentLinkPaid = async (paymentLinkEntity, paymentEntity, requestId) => {
  try {
    console.log(`🔍 [${requestId}] Processing payment link: ${paymentLinkEntity.id}`);
    
    const orderDetails = orderStore.get(paymentLinkEntity.id);
    
    if (!orderDetails) {
      console.error(`❌ [${requestId}] Order not found in store: ${paymentLinkEntity.id}`);
      
      // Enhanced recovery attempt
      const recoveryResult = await attemptDataRecovery(paymentLinkEntity, paymentEntity, requestId);
      if (recoveryResult.success) {
        console.log(`✅ [${requestId}] Recovery successful`);
        return;
      }
      
      console.error(`❌ [${requestId}] Recovery failed`);
      return;
    }
    
    // Prevent duplicate processing
    if (orderDetails.status === "paid") {
      console.log(`⚠️ [${requestId}] Payment already processed: ${paymentLinkEntity.id}`);
      return;
    }

    console.log(`💰 [${requestId}] Processing payment: ${paymentEntity.id}`);
    
    // Update status to processing
    updateOrderStore(paymentLinkEntity.id, { 
      status: "processing", 
      paymentId: paymentEntity.id,
      webhookProcessed: true
    });
    
    // Enhanced booking data preparation
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentEntity.id,
      orderId: paymentEntity.order_id,
      paymentLinkId: paymentLinkEntity.id,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      totalAmount: orderDetails.bookingData.totalAmount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId,
      webhookProcessed: true,
      dataIntegrityCheck: 'webhook_processed'
    };

    const paymentDetails = {
      razorpay_payment_id: paymentEntity.id,
      razorpay_order_id: paymentEntity.order_id,
      payment_link_id: paymentLinkEntity.id,
    };

    console.log(`💾 [${requestId}] Saving data to Firebase and Sheets...`);

    // Enhanced parallel saving with individual error handling
    const saveResults = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    // Enhanced results processing
    const dataStored = {
      firebase: saveResults[0].status === 'fulfilled',
      sheets: saveResults[1].status === 'fulfilled',
      firebaseError: saveResults[0].status === 'rejected' ? saveResults[0].reason?.message : null,
      sheetsError: saveResults[1].status === 'rejected' ? saveResults[1].reason?.message : null,
      firebaseData: saveResults[0].status === 'fulfilled' ? saveResults[0].value : null,
      sheetsData: saveResults[1].status === 'fulfilled' ? saveResults[1].value : null,
      timestamp: new Date().toISOString(),
      requestId
    };

    console.log(`📊 [${requestId}] Data storage results:`, {
      firebase: dataStored.firebase,
      sheets: dataStored.sheets,
      errors: {
        firebase: dataStored.firebaseError,
        sheets: dataStored.sheetsError
      }
    });

    // Update order status with comprehensive data
    updateOrderStore(paymentLinkEntity.id, {
      status: "paid",
      paymentEntity: paymentEntity,
      dataStored: dataStored,
      savedBooking: dataStored.firebaseData,
      processedAt: new Date().toISOString(),
      webhookRequestId: requestId,
      dataIntegrityCheck: 'completed'
    });
    
    console.log(`✅ [${requestId}] Payment processing completed successfully`);
    
  } catch (error) {
    console.error(`❌ [${requestId}] Payment processing failed:`, error);
    
    // Update order with error status
    updateOrderStore(paymentLinkEntity.id, {
      status: "error",
      error: error.message,
      errorAt: new Date().toISOString(),
      webhookRequestId: requestId,
      dataIntegrityCheck: 'failed'
    });
  }
};

// Enhanced data recovery attempt
const attemptDataRecovery = async (paymentLinkEntity, paymentEntity, requestId) => {
  try {
    console.log(`🔄 [${requestId}] Attempting data recovery for: ${paymentLinkEntity.id}`);
    
    // Try to fetch from Razorpay API
    const paymentLinkDetails = await razorpay.paymentLink.fetch(paymentLinkEntity.id);
    
    if (paymentLinkDetails && paymentLinkDetails.notes && paymentLinkDetails.notes.bookingData) {
      console.log(`✅ [${requestId}] Found booking data in Razorpay notes`);
      
      const recoveredBookingData = JSON.parse(paymentLinkDetails.notes.bookingData);
      
      const bookingDataWithPayment = {
        ...recoveredBookingData,
        paymentId: paymentEntity.id,
        orderId: paymentEntity.order_id,
        paymentLinkId: paymentLinkEntity.id,
        advanceAmount: paymentLinkDetails.amount / 100,
        remainingAmount: recoveredBookingData.totalAmount - (paymentLinkDetails.amount / 100),
        webhookProcessedAt: new Date().toISOString(),
        webhookRequestId: requestId,
        recoveryAttempts: (recoveredBookingData.recoveryAttempts || 0) + 1,
        source: 'webhook_recovery',
        dataIntegrityCheck: 'recovered'
      };

      const paymentDetails = {
        razorpay_payment_id: paymentEntity.id,
        razorpay_order_id: paymentEntity.order_id,
        payment_link_id: paymentLinkEntity.id,
      };

      // Save recovered data
      const saveResults = await Promise.allSettled([
        saveToFirebase(bookingDataWithPayment, paymentDetails),
        saveBookingToSheet(bookingDataWithPayment)
      ]);

      const dataStored = {
        firebase: saveResults[0].status === 'fulfilled',
        sheets: saveResults[1].status === 'fulfilled',
        firebaseError: saveResults[0].status === 'rejected' ? saveResults[0].reason?.message : null,
        sheetsError: saveResults[1].status === 'rejected' ? saveResults[1].reason?.message : null,
        timestamp: new Date().toISOString(),
        recovered: true,
        requestId
      };

      // Store recovered data
      addToOrderStore(paymentLinkEntity.id, {
        bookingData: bookingDataWithPayment,
        amount: paymentLinkDetails.amount / 100,
        status: "paid",
        type: "payment_link",
        paymentEntity: paymentEntity,
        dataStored: dataStored,
        savedBooking: saveResults[0].status === 'fulfilled' ? saveResults[0].value : null,
        processedAt: new Date().toISOString(),
        webhookRequestId: requestId,
        recovered: true,
        dataIntegrityCheck: 'recovered'
      });

      console.log(`✅ [${requestId}] Recovery completed successfully`);
      return { success: true, dataStored };
    }
    
    return { success: false, error: "No recoverable data found" };
    
  } catch (error) {
    console.error(`❌ [${requestId}] Recovery attempt failed:`, error);
    return { success: false, error: error.message };
  }
};

// Enhanced regular payment handler
const handlePaymentCaptured = async (paymentEntity, requestId) => {
  try {
    const orderId = paymentEntity.order_id;
    const orderDetails = orderStore.get(orderId);
    
    if (!orderDetails) {
      console.log(`⚠️ [${requestId}] Order not found for regular payment: ${orderId}`);
      return;
    }
    
    console.log(`💰 [${requestId}] Processing regular payment: ${paymentEntity.id}`);
    
    // Similar processing as payment link
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentEntity.id,
      orderId: orderId,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      totalAmount: orderDetails.bookingData.totalAmount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId,
      webhookProcessed: true,
      dataIntegrityCheck: 'webhook_processed'
    };

    const paymentDetails = {
      razorpay_payment_id: paymentEntity.id,
      razorpay_order_id: orderId,
      razorpay_signature: "webhook_verified",
    };

    // Save to both services
    const saveResults = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    const dataStored = {
      firebase: saveResults[0].status === 'fulfilled',
      sheets: saveResults[1].status === 'fulfilled',
      firebaseError: saveResults[0].status === 'rejected' ? saveResults[0].reason?.message : null,
      sheetsError: saveResults[1].status === 'rejected' ? saveResults[1].reason?.message : null,
      timestamp: new Date().toISOString(),
      requestId
    };

    // Update order status
    updateOrderStore(orderId, {
      status: "paid",
      paymentId: paymentEntity.id,
      dataStored: dataStored,
      savedBooking: saveResults[0].status === 'fulfilled' ? saveResults[0].value : null,
      processedAt: new Date().toISOString(),
      webhookRequestId: requestId,
      dataIntegrityCheck: 'completed'
    });

    console.log(`✅ [${requestId}] Regular payment processed successfully`);
    
  } catch (error) {
    console.error(`❌ [${requestId}] Regular payment processing failed:`, error);
  }
};

// Enhanced payment failure handler
const handlePaymentFailed = async (paymentEntity, requestId) => {
  try {
    const orderId = paymentEntity.order_id;
    console.log(`❌ [${requestId}] Payment failed - Order: ${orderId}, Payment: ${paymentEntity.id}`);

    const orderDetails = orderStore.get(orderId);
    if (orderDetails) {
      updateOrderStore(orderId, {
        status: "failed",
        error: "Payment failed",
        failedAt: new Date().toISOString(),
        webhookRequestId: requestId,
        dataIntegrityCheck: 'payment_failed'
      });
    }
    
  } catch (error) {
    console.error(`❌ [${requestId}] Payment failure handling error:`, error);
  }
};

// Enhanced payment link cancelled handler
const handlePaymentLinkCancelled = async (paymentLinkEntity, requestId) => {
  try {
    console.log(`❌ [${requestId}] Payment link cancelled: ${paymentLinkEntity.id}`);
    
    updateOrderStore(paymentLinkEntity.id, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      webhookRequestId: requestId,
      dataIntegrityCheck: 'cancelled'
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Payment link cancellation handling error:`, error);
  }
};

// Enhanced payment status endpoint
app.get("/payment-status/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { requestId } = req;
    
    console.log(`🔍 [${requestId}] Checking payment status: ${paymentId}`);
    
    // Check local store first
    const orderDetails = orderStore.get(paymentId);
    
    if (orderDetails) {
      console.log(`📊 [${requestId}] Order found in store:`, {
        status: orderDetails.status,
        type: orderDetails.type,
        hasDataStored: !!orderDetails.dataStored,
        recovered: orderDetails.recovered || false
      });
      
      if (orderDetails.status === "paid") {
        return res.json({
          success: true,
          status: "paid",
          bookingData: orderDetails.savedBooking,
          paymentDetails: orderDetails.paymentEntity,
          dataStored: orderDetails.dataStored,
          type: orderDetails.type || "order",
          processedAt: orderDetails.processedAt,
          recovered: orderDetails.recovered || false,
          sessionId: orderDetails.sessionId,
          dataIntegrityCheck: orderDetails.dataIntegrityCheck
        });
      }
      
      if (orderDetails.status === "processing") {
        return res.json({
          success: true,
          status: "processing",
          message: "Payment is being processed",
          type: orderDetails.type || "order"
        });
      }
    }
    
    // For payment links, check with Razorpay API
    if (paymentId.startsWith('plink_')) {
      try {
        console.log(`🔍 [${requestId}] Checking with Razorpay API...`);
        const paymentLink = await razorpay.paymentLink.fetch(paymentId);
        
        if (paymentLink.status === "paid") {
          console.log(`✅ [${requestId}] Payment link paid but not processed locally`);
          return res.json({
            success: true,
            status: "paid",
            razorpayStatus: paymentLink.status,
            needsRecovery: !orderDetails,
            type: "payment_link",
            amount: paymentLink.amount / 100,
            created_at: paymentLink.created_at
          });
        } else {
          console.log(`⏳ [${requestId}] Payment link status: ${paymentLink.status}`);
          return res.json({
            success: true,
            status: paymentLink.status,
            razorpayStatus: paymentLink.status,
            type: "payment_link",
            amount: paymentLink.amount / 100,
            created_at: paymentLink.created_at
          });
        }
      } catch (apiError) {
        console.error(`❌ [${requestId}] Razorpay API error:`, apiError);
        return res.json({
          success: false,
          status: "unknown",
          error: "Could not verify payment status with Razorpay",
          details: apiError.message
        });
      }
    }
    
    // For regular orders
    if (orderDetails) {
      res.json({
        success: orderDetails.status !== "error",
        status: orderDetails.status,
        bookingData: orderDetails.savedBooking,
        message: orderDetails.status === "failed" ? orderDetails.error : `Payment ${orderDetails.status}`,
        type: "order",
        dataStored: orderDetails.dataStored,
        dataIntegrityCheck: orderDetails.dataIntegrityCheck
      });
    } else {
      res.status(404).json({
        success: false,
        status: "not_found",
        message: "Payment not found in our records",
      });
    }
    
  } catch (error) {
    console.error(`❌ [${req.requestId}] Payment status check failed:`, error);
    res.status(500).json({ 
      success: false,
      error: "Status check failed", 
      details: error.message 
    });
  }
});

// Enhanced payment recovery endpoint
app.post("/recover-payment", async (req, res) => {
  try {
    const { paymentLinkId, bookingData } = req.body;
    const { requestId } = req;
    
    if (!paymentLinkId) {
      return res.status(400).json({ 
        success: false,
        error: "Payment link ID required" 
      });
    }
    
    console.log(`🔄 [${requestId}] Starting enhanced recovery for: ${paymentLinkId}`);
    
    // Check payment link status with Razorpay
    const paymentLink = await razorpay.paymentLink.fetch(paymentLinkId);
    
    if (paymentLink.status === "paid") {
      // Get payments for this payment link
      const payments = await razorpay.payments.all({
        'payment_link_id': paymentLinkId,
        'count': 1
      });
      
      if (payments.items.length > 0) {
        const payment = payments.items[0];
        
        console.log(`🔄 [${requestId}] Found payment to recover: ${payment.id}`);
        
        // Enhanced recovery data preparation
        const recoveryBookingData = {
          ...bookingData,
          paymentId: payment.id,
          orderId: payment.order_id,
          paymentLinkId: paymentLinkId,
          advanceAmount: paymentLink.amount / 100,
          remainingAmount: bookingData.totalAmount - (paymentLink.amount / 100),
          totalAmount: bookingData.totalAmount,
          recoveredAt: new Date().toISOString(),
          source: 'manual_recovery',
          recoveryAttempts: (bookingData.recoveryAttempts || 0) + 1,
          webhookProcessed: false,
          dataIntegrityCheck: 'manual_recovery'
        };

        const paymentDetails = {
          razorpay_payment_id: payment.id,
          razorpay_order_id: payment.order_id,
          payment_link_id: paymentLinkId,
        };

        // Save with enhanced error handling
        const saveResults = await Promise.allSettled([
          saveToFirebase(recoveryBookingData, paymentDetails),
          saveBookingToSheet(recoveryBookingData)
        ]);
        
        const dataStored = {
          firebase: saveResults[0].status === 'fulfilled',
          sheets: saveResults[1].status === 'fulfilled',
          firebaseError: saveResults[0].status === 'rejected' ? saveResults[0].reason?.message : null,
          sheetsError: saveResults[1].status === 'rejected' ? saveResults[1].reason?.message : null,
          firebaseData: saveResults[0].status === 'fulfilled' ? saveResults[0].value : null,
          sheetsData: saveResults[1].status === 'fulfilled' ? saveResults[1].value : null,
        }
      }
      if (paymentLinkDetails && paymentLinkDetails.notes && paymentLinkDetails.notes.session_id) {
          recovered: true,
          requestId
        // Try to recover from order store using session_id or reference_id
        const sessionId = paymentLinkDetails.notes.session_id;
        const referenceId = paymentLinkDetails.notes.reference_id;
        
        // Look for stored data using session_id or reference_id
        let recoveredBookingData = null;
        for (const [id, orderData] of orderStore.entries()) {
          if (orderData.sessionId === sessionId || orderData.reference_id === referenceId) {
            recoveredBookingData = orderData.bookingData;
            break;
          }
        }
        
        if (!recoveredBookingData) {
          // Create minimal booking data from notes
          recoveredBookingData = {
            bookingName: paymentLinkDetails.notes.booking_name || 'Customer',
            date: paymentLinkDetails.notes.date || '',
            people: parseInt(paymentLinkDetails.notes.people) || 1,
            totalAmount: parseFloat(paymentLinkDetails.notes.amount) * 10 || 100, // Estimate total
            sessionId: sessionId,
            reference_id: referenceId,
            source: 'webhook_recovery_minimal',
            recoveryNote: 'Recovered from minimal Razorpay notes data'
          };
        }

        // Update order store with recovered data
        addToOrderStore(paymentLinkId, {
          bookingData: recoveryBookingData,
          amount: paymentLink.amount / 100,
          status: "paid",
          type: "payment_link",
          paymentEntity: payment,
          dataStored: dataStored,
          savedBooking: dataStored.firebaseData,
          processedAt: new Date().toISOString(),
          recovered: true,
          dataIntegrityCheck: 'recovered'
        });

        console.log(`✅ [${requestId}] Recovery completed:`, {
          firebase: dataStored.firebase,
          sheets: dataStored.sheets
        });
        
        res.json({
          success: true,
          status: "recovered",
          paymentId: payment.id,
          dataStored: dataStored,
          bookingData: dataStored.firebaseData,
          recoveryDetails: {
            timestamp: new Date().toISOString(),
            paymentLinkId,
            paymentId: payment.id,
            amount: paymentLink.amount / 100
          }
        });
        
      } else {
        console.log(`⚠️ [${requestId}] No payments found for: ${paymentLinkId}`);
        res.json({ 
          success: false,
          status: "no_payment_found",
          message: "No payments found for this payment link"
        });
      }
    } else {
      console.log(`⚠️ [${requestId}] Payment link not paid: ${paymentLink.status}`);
      res.json({ 
        success: false,
        status: "not_paid",
        paymentLinkStatus: paymentLink.status,
        message: "Payment link has not been paid yet"
      });
    }
    
  } catch (error) {
    console.error(`❌ [${req.requestId}] Recovery failed:`, error);
    res.status(500).json({ 
      success: false,
      error: "Recovery failed", 
      details: error.message 
    });
  }
});

// Enhanced cleanup with better TTL management
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  let totalCount = orderStore.size;

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
    console.log(`🧹 Cleaned ${cleanedCount}/${totalCount} expired orders (${orderStore.size} remaining)`);
  }
}
)

// Enhanced health check endpoint
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
    version: "3.0 - Enhanced Payment System with Data Integrity",
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Enhanced debug endpoint
if (process.env.NODE_ENV === 'development') {
  app.get("/debug/orders", (req, res) => {
    const orders = Array.from(orderStore.entries()).map(([id, order]) => ({
      id,
      status: order.status,
      type: order.type,
      createdAt: order.createdAt,
      dataStored: order.dataStored,
      recovered: order.recovered || false,
      dataIntegrityCheck: order.dataIntegrityCheck,
      bookingName: order.bookingData?.bookingName,
      amount: order.amount
    }));
    
    res.json({ 
      success: true,
      orders, 
      count: orders.length,
      summary: {
        total: orders.length,
        paid: orders.filter(o => o.status === 'paid').length,
        processing: orders.filter(o => o.status === 'processing').length,
        failed: orders.filter(o => o.status === 'failed').length,
        recovered: orders.filter(o => o.recovered).length
      }
    });
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
  console.log(`🚀 Enhanced Payment System Server running on port ${PORT}`);
  console.log(`📡 Version: 3.0 - Enhanced Data Integrity`);
  console.log(`🔗 Payment Links API: /create-payment-link`);
  console.log(`🔔 Webhook endpoint: /webhook`);
  console.log(`🔄 Recovery endpoint: /recover-payment`);
  console.log(`📊 Health check: /health`);
  console.log(`🔍 Status check: /payment-status/:paymentId`);
  console.log(`⚡ Enhanced error handling and data integrity enabled`);
});
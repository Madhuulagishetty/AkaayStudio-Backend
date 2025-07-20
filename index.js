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

// Enhanced middleware
app.use(cors());

// CRITICAL: Raw body parser for webhook signature verification
app.use('/webhook', express.raw({ 
  type: 'application/json',
  limit: '10mb'
}));

// JSON parser for all other routes
app.use(express.json({ limit: '10mb' }));

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// 🎯 ENHANCED DUPLICATE PREVENTION SYSTEM
const orderStore = new Map();
const processedPayments = new Map(); // Changed to Map to store timestamps
const duplicateAttempts = new Map(); // Track duplicate attempts for monitoring

// 🎯 CRITICAL: Enhanced duplicate tracking with multiple strategies
const markAsProcessed = (paymentId, paymentLinkId = null, context = 'unknown') => {
  const timestamp = new Date().toISOString();
  
  // Mark payment ID
  processedPayments.set(paymentId, {
    timestamp,
    context,
    paymentLinkId
  });
  
  // Mark payment link ID if available
  if (paymentLinkId) {
    const paymentLinkKey = `plink_${paymentLinkId}`;
    processedPayments.set(paymentLinkKey, {
      timestamp,
      context,
      paymentId
    });
  }
  
  console.log(`🔒 Marked as processed: ${paymentId} (${context})`);
  if (paymentLinkId) {
    console.log(`🔒 Marked payment link as processed: ${paymentLinkId} (${context})`);
  }
};

// 🎯 CRITICAL: Check if payment was already processed
const isAlreadyProcessed = (paymentId, paymentLinkId = null) => {
  // Check payment ID
  if (processedPayments.has(paymentId)) {
    const info = processedPayments.get(paymentId);
    console.log(`⚠️ DUPLICATE DETECTED: Payment ${paymentId} already processed at ${info.timestamp} (${info.context})`);
    return true;
  }
  
  // Check payment link ID
  if (paymentLinkId) {
    const paymentLinkKey = `plink_${paymentLinkId}`;
    if (processedPayments.has(paymentLinkKey)) {
      const info = processedPayments.get(paymentLinkKey);
      console.log(`⚠️ DUPLICATE DETECTED: Payment link ${paymentLinkId} already processed at ${info.timestamp} (${info.context})`);
      return true;
    }
  }
  
  return false;
};

// 🎯 CRITICAL: Track duplicate attempts for monitoring
const trackDuplicateAttempt = (paymentId, paymentLinkId, context) => {
  const key = paymentLinkId ? `${paymentId}_${paymentLinkId}` : paymentId;
  
  if (!duplicateAttempts.has(key)) {
    duplicateAttempts.set(key, []);
  }
  
  duplicateAttempts.get(key).push({
    timestamp: new Date().toISOString(),
    context,
    paymentId,
    paymentLinkId
  });
  
  console.log(`📊 Duplicate attempt #${duplicateAttempts.get(key).length} for ${key} (${context})`);
};

// Enhanced Google Sheets saving with retry logic
const saveBookingToSheet = async (bookingData, retryCount = 0) => {
  const maxRetries = 3;
  
  try {
    console.log(`📝 Saving booking to Google Sheets (attempt ${retryCount + 1})...`);
    
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
      booking_time: bookingData.lastItem
        ? `${bookingData.lastItem.start} - ${bookingData.lastItem.end}`
        : bookingData.cartData && bookingData.cartData.length > 0
        ? `${bookingData.cartData[0].start} - ${bookingData.cartData[0].end}`
        : "Not Available",
      whatsapp_number: bookingData.whatsapp || '',
      num_people: bookingData.people || 0,
      decoration: bookingData.wantDecoration === "Yes" ? "Yes" : "No",
      advance_amount: bookingData.advanceAmount || 10,
      remaining_amount: bookingData.remainingAmount || (bookingData.totalAmount - 10) || 0,
      total_amount: bookingData.totalAmount || 0,
      payment_id: bookingData.paymentId || '',
      extraDecorations: Array.isArray(bookingData.extraDecorations) 
        ? bookingData.extraDecorations.join(', ') 
        : bookingData.extraDecorations || '',
      address: bookingData.address || '',
      bookingName: bookingData.bookingName || '',
      slotType: bookingData.slotType || '',
      email: bookingData.email || '',
      payment_status: "Completed (Advance paid)",
      NameUser: bookingData.NameUser || bookingData.bookingName || '',
      PaymentMode: "Online",
      occasion: bookingData.occasion || '',
      processed_date: currentDate,
      processed_time: currentTime,
      processed_timestamp: isoTimestamp,
      order_id: bookingData.orderId || '',
      payment_link_id: bookingData.paymentLinkId || '',
      source: bookingData.source || 'web_app',
      created_at: bookingData.createdAt || isoTimestamp,
      webhook_processed: true,
      webhook_timestamp: isoTimestamp,
      recovery_type: bookingData.minimal ? 'minimal' : bookingData.recovered ? 'recovered' : 'normal',
      duplicate_prevention_version: '4.0', // 🎯 NEW: Track version for monitoring
      save_context: bookingData.saveContext || 'webhook' // 🎯 NEW: Track save source
    };

    console.log("📊 Sheet data prepared:", {
      booking_date: sheetData.booking_date,
      payment_id: sheetData.payment_id,
      total_amount: sheetData.total_amount,
      whatsapp_number: sheetData.whatsapp_number,
      save_context: sheetData.save_context
    });

    const response = await axios.post(
      "https://sheetdb.io/api/v1/s6a0t5omac7jg",
      {
        data: [sheetData],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000, // Increased timeout
      }
    );

    console.log("✅ Google Sheets save successful:", response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ Error saving to Google Sheets (attempt ${retryCount + 1}):`, error.response?.data || error.message);
    
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying Google Sheets save in 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return saveBookingToSheet(bookingData, retryCount + 1);
    }
    
    throw error;
  }
};

// Enhanced Firebase saving with retry logic
const saveToFirebase = async (bookingData, paymentDetails, retryCount = 0) => {
  const maxRetries = 3;
  
  try {
    console.log(`🔥 Saving booking to Firebase (attempt ${retryCount + 1})...`);
    
    const saveData = {
      bookingName: bookingData.bookingName || '',
      NameUser: bookingData.NameUser || bookingData.bookingName || '',
      email: bookingData.email || '',
      address: bookingData.address || '',
      whatsapp: bookingData.whatsapp || '',
      date: bookingData.date || '',
      people: bookingData.people || 0,
      wantDecoration: bookingData.wantDecoration === "Yes",
      occasion: bookingData.occasion || '',
      extraDecorations: bookingData.extraDecorations || [],
      selectedTimeSlot: bookingData.lastItem || (bookingData.cartData && bookingData.cartData[0]) || null,
      lastItem: bookingData.lastItem || (bookingData.cartData && bookingData.cartData[0]) || null,
      cartData: bookingData.cartData || [],
      slotType: bookingData.slotType || '',
      status: "booked",
      paymentId: paymentDetails.razorpay_payment_id || '',
      orderId: paymentDetails.razorpay_order_id || '',
      paymentLinkId: paymentDetails.payment_link_id || '',
      paymentStatus: "completed",
      advancePaid: bookingData.advanceAmount || 10,
      remainingAmount: bookingData.remainingAmount || (bookingData.totalAmount - 10) || 0,
      totalAmount: bookingData.totalAmount || 0,
      timestamp: new Date(),
      createdAt: bookingData.createdAt ? new Date(bookingData.createdAt) : new Date(),
      source: bookingData.source || 'web_app',
      webhookProcessed: true,
      webhookTimestamp: new Date(),
      recoveryType: bookingData.minimal ? 'minimal' : bookingData.recovered ? 'recovered' : 'normal',
      duplicatePreventionVersion: '4.0', // 🎯 NEW: Track version for monitoring
      saveContext: bookingData.saveContext || 'webhook', // 🎯 NEW: Track save source
      bookingMeta: {
        createdAt: new Date(),
        source: "web",
        version: "4.0",
        paymentMethod: "razorpay_payment_link",
        webhookProcessed: true,
        processedAt: new Date().toISOString(),
        duplicatePreventionActive: true
      },
    };

    console.log("📊 Firebase data prepared:", {
      bookingName: saveData.bookingName,
      paymentId: saveData.paymentId,
      totalAmount: saveData.totalAmount,
      whatsapp: saveData.whatsapp,
      saveContext: saveData.saveContext
    });

    const collectionName = bookingData.slotType || 'bookings';
    const docRef = await addDoc(collection(db, collectionName), saveData);
    
    console.log("✅ Firebase save successful with ID:", docRef.id);
    return { ...saveData, id: docRef.id };
  } catch (error) {
    console.error(`❌ Error saving to Firebase (attempt ${retryCount + 1}):`, error.message);
    
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying Firebase save in 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return saveToFirebase(bookingData, paymentDetails, retryCount + 1);
    }
    
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

// Enhanced data sanitization for Razorpay compatibility
const sanitizeForRazorpay = (str) => {
  if (!str) return "";
  
  return str
    .toString()
    .trim()
    // Remove or replace problematic characters
    .replace(/[^\x00-\x7F]/g, "") // Remove non-ASCII characters
    .replace(/['"]/g, "") // Remove quotes
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/[{}]/g, "") // Remove curly braces
    .replace(/[\[\]]/g, "") // Remove square brackets
    .replace(/[\\]/g, "") // Remove backslashes
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .substring(0, 100); // Limit length to prevent issues
};

// Enhanced email validation and sanitization
const sanitizeEmail = (email) => {
  if (!email) return "";
  
  const cleanEmail = email
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\w@.-]/g, ""); // Keep only alphanumeric, @, ., and -
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(cleanEmail) ? cleanEmail : "";
};

// Enhanced name sanitization
const sanitizeName = (name) => {
  if (!name) return "Customer";
  
  return name
    .toString()
    .trim()
    .replace(/[^\w\s.-]/g, "") // Keep only alphanumeric, spaces, dots, and hyphens
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .substring(0, 100) // Limit to 100 characters
    || "Customer"; // Fallback if empty after sanitization
};

// 🎯 CRITICAL: Enhanced single data save function with duplicate prevention
const saveBookingDataOnce = async (bookingData, paymentDetails, requestId, context = 'webhook') => {
  const paymentId = paymentDetails.razorpay_payment_id;
  const paymentLinkId = paymentDetails.payment_link_id;
  
  // 🎯 CRITICAL: Check for duplicates BEFORE any processing
  if (isAlreadyProcessed(paymentId, paymentLinkId)) {
    trackDuplicateAttempt(paymentId, paymentLinkId, context);
    console.log(`🚫 [${requestId}] DUPLICATE SAVE PREVENTED for payment: ${paymentId} (${context})`);
    return {
      status: 'duplicate_prevented',
      message: 'Data already saved - duplicate prevented',
      paymentId,
      paymentLinkId,
      originalContext: processedPayments.get(paymentId)?.context || 'unknown'
    };
  }
  
  // 🎯 CRITICAL: Mark as processing IMMEDIATELY to prevent race conditions
  markAsProcessed(paymentId, paymentLinkId, context);
  
  try {
    console.log(`💾 [${requestId}] 🎯 SINGLE DATA SAVE: Starting for payment ${paymentId} (${context})...`);
    
    // Add save context to booking data
    const enhancedBookingData = {
      ...bookingData,
      saveContext: context,
      savedAt: new Date().toISOString(),
      requestId
    };
    
    // Save to both services with enhanced error handling
    const [firebaseResult, sheetsResult] = await Promise.allSettled([
      saveToFirebase(enhancedBookingData, paymentDetails),
      saveBookingToSheet(enhancedBookingData)
    ]);

    // Log detailed results
    const dataStored = {
      firebase: firebaseResult.status === 'fulfilled',
      sheets: sheetsResult.status === 'fulfilled',
      firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
      sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
      timestamp: new Date().toISOString(),
      context,
      paymentId,
      paymentLinkId,
      requestId
    };

    console.log(`📊 [${requestId}] 🎯 SINGLE SAVE RESULTS (${context}):`, dataStored);

    if (dataStored.firebase && dataStored.sheets) {
      console.log(`✅ [${requestId}] 🎯 SINGLE SAVE SUCCESS: Data saved to both Firebase and Sheets (${context})`);
    } else if (dataStored.firebase || dataStored.sheets) {
      console.log(`⚠️ [${requestId}] 🎯 SINGLE SAVE PARTIAL: Data saved to ${dataStored.firebase ? 'Firebase' : 'Sheets'} only (${context})`);
    } else {
      console.log(`❌ [${requestId}] 🎯 SINGLE SAVE FAILURE: Data not saved to either service (${context})`);
      // Remove from processed set if save failed completely
      processedPayments.delete(paymentId);
      if (paymentLinkId) {
        processedPayments.delete(`plink_${paymentLinkId}`);
      }
    }
    
    return {
      status: dataStored.firebase && dataStored.sheets ? 'success' : 
              dataStored.firebase || dataStored.sheets ? 'partial' : 'failed',
      dataStored,
      savedBooking: firebaseResult.status === 'fulfilled' ? firebaseResult.value : null
    };
    
  } catch (error) {
    console.error(`❌ [${requestId}] Single data save failed (${context}):`, error);
    
    // Remove from processed set if save failed
    processedPayments.delete(paymentId);
    if (paymentLinkId) {
      processedPayments.delete(`plink_${paymentLinkId}`);
    }
    
    throw error;
  }
};

// Payment link creation WITHOUT immediate data save
app.post("/create-payment-link", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    
    if (!bookingData || !amount) {
      return res.status(400).json({ error: "Missing booking data or amount" });
    }

    // Sanitize all input data before processing
    const sanitizedBookingData = {
      ...bookingData,
      bookingName: sanitizeName(bookingData.bookingName),
      NameUser: sanitizeName(bookingData.NameUser),
      email: sanitizeEmail(bookingData.email),
      address: sanitizeForRazorpay(bookingData.address),
      occasion: sanitizeForRazorpay(bookingData.occasion),
      whatsapp: validateAndSanitizePhone(bookingData.whatsapp)
    };

    console.log("🔗 Creating payment link for booking:", {
      name: sanitizedBookingData.bookingName,
      amount: amount,
      whatsapp: sanitizedBookingData.whatsapp,
      email: sanitizedBookingData.email
    });

    const sanitizedPhone = sanitizedBookingData.whatsapp;
    const referenceId = "booking_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    
    // Sanitize data for Razorpay API
    const sanitizedCustomerName = sanitizeName(sanitizedBookingData.bookingName);
    const sanitizedEmail = sanitizeEmail(sanitizedBookingData.email);
    const sanitizedDescription = sanitizeForRazorpay(
      `Theater Booking - ${sanitizedCustomerName} - ${sanitizedBookingData.occasion || 'Celebration'}`
    );
    
    const options = {
      amount: amount * 100, // Convert to paise
      currency: "INR",
      reference_id: referenceId,
      description: sanitizedDescription,
      customer: {
        name: sanitizedCustomerName,
        email: sanitizedEmail,
      },
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
      callback_url: `${process.env.FRONTEND_URL || 'https://birthday-backend-tau.vercel.app'}/payment-success`,
      callback_method: "get",
      // Store minimal sanitized data in notes (under 255 chars)
      notes: {
        ref_id: referenceId,
        customer: sanitizedCustomerName.substring(0, 30),
        source: 'web_app',
        amount: amount.toString(),
        occasion: sanitizeForRazorpay(sanitizedBookingData.occasion || '').substring(0, 20)
      }
    };

    // Add phone only if valid
    if (sanitizedPhone) {
      options.customer.contact = sanitizedPhone;
    }

    console.log("📋 Sanitized payment link options:", {
      description: options.description,
      customer: options.customer,
      notes: options.notes
    });
    
    const paymentLink = await razorpay.paymentLink.create(options);
    
    // Store enhanced booking data with expiration (NO DATA SAVE TO FIREBASE/SHEETS)
    const enhancedBookingData = {
      ...sanitizedBookingData,
      totalAmount: sanitizedBookingData.totalAmount || sanitizedBookingData.amountWithTax,
      advanceAmount: amount,
      remainingAmount: (sanitizedBookingData.totalAmount || sanitizedBookingData.amountWithTax) - amount,
      source: 'web_app',
      createdAt: new Date().toISOString(),
      reference_id: referenceId,
      paymentLinkId: paymentLink.id
    };

    // Store with multiple keys for better lookup (IN MEMORY ONLY)
    const orderData = {
      bookingData: enhancedBookingData,
      amount,
      status: "created",
      type: "payment_link",
      createdAt: new Date(),
      reference_id: referenceId,
      paymentLinkId: paymentLink.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    };

    // Store with payment link ID as primary key (IN MEMORY ONLY - NO DATABASE SAVE)
    orderStore.set(paymentLink.id, orderData);
    // Also store with reference ID for backup lookup
    orderStore.set(referenceId, orderData);

    console.log(`✅ Payment link created: ${paymentLink.id}`);
    console.log(`📦 Order data stored IN MEMORY with keys: ${paymentLink.id}, ${referenceId}`);
    console.log(`🚫 NO immediate data save - will save only after successful payment via webhook`);
    
    res.json({
      paymentLink,
      short_url: paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      referenceId: referenceId,
    });
  } catch (error) {
    console.error("❌ Payment link creation failed:", error);
    res.status(500).json({ 
      error: "Payment link creation failed",
      details: error.message 
    });
  }
});

// Enhanced webhook signature verification
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
    console.error("❌ Signature verification error:", error);
    return false;
  }
};

// 🎯 CRITICAL: Enhanced webhook handler with ultimate duplicate prevention
app.post("/webhook", async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  try {
    const webhookSignature = req.headers["x-razorpay-signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    console.log(`🔔 [${requestId}] Webhook received at ${new Date().toISOString()}`);
    console.log(`🔍 [${requestId}] Headers:`, {
      signature: webhookSignature ? 'Present' : 'Missing',
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length']
    });
    
    if (!webhookSecret) {
      console.error(`❌ [${requestId}] Webhook secret not configured`);
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!webhookSignature) {
      console.error(`❌ [${requestId}] Missing webhook signature`);
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    // Verify webhook signature using raw body
    const isValidSignature = verifyWebhookSignature(
      req.body,
      webhookSignature,
      webhookSecret
    );

    if (!isValidSignature) {
      console.error(`❌ [${requestId}] Invalid webhook signature`);
      return res.status(400).json({ error: "Invalid signature" });
    }

    console.log(`✅ [${requestId}] Webhook signature verified`);

    // Parse the event from raw body
    const event = JSON.parse(req.body.toString('utf8'));
    
    console.log(`🔔 [${requestId}] Event: ${event.event}`);
    console.log(`📊 [${requestId}] Event details:`, {
      event: event.event,
      entity: event.payload?.payment?.entity?.id || event.payload?.payment_link?.entity?.id || 'Unknown'
    });

    // 🎯 CRITICAL: Handle only payment_link.paid events to prevent duplicates
    switch (event.event) {
      case "payment_link.paid":
        await handlePaymentLinkPaid(event.payload.payment_link.entity, event.payload.payment.entity, requestId);
        break;
        
      case "payment.captured":
        // 🎯 CRITICAL: Only handle if NOT a payment link payment
        const paymentEntity = event.payload.payment.entity;
        if (!paymentEntity.payment_link_id) {
          await handlePaymentCaptured(paymentEntity, requestId);
        } else {
          console.log(`ℹ️ [${requestId}] Skipping payment.captured for payment link payment: ${paymentEntity.id}`);
        }
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
      status: "success", 
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

// 🎯 CRITICAL: Enhanced payment link handler - SINGLE DATA SAVE ONLY
const handlePaymentLinkPaid = async (paymentLinkEntity, paymentEntity, requestId) => {
  try {
    const paymentLinkId = paymentLinkEntity.id;
    const paymentId = paymentEntity.id;
    
    console.log(`🔍 [${requestId}] Processing payment link: ${paymentLinkId} with payment: ${paymentId}`);
    
    // 🎯 CRITICAL: Check for duplicates with enhanced tracking
    if (isAlreadyProcessed(paymentId, paymentLinkId)) {
      trackDuplicateAttempt(paymentId, paymentLinkId, 'payment_link.paid');
      console.log(`🚫 [${requestId}] DUPLICATE PREVENTED: Payment link ${paymentLinkId} already processed`);
      return;
    }
    
    // Try to find order details with multiple lookup strategies
    let orderDetails = null;
    
    // Strategy 1: Look up by payment link ID
    orderDetails = orderStore.get(paymentLinkId);
    
    if (!orderDetails) {
      console.log(`🔍 [${requestId}] Order not found by payment link ID, trying reference ID lookup...`);
      
      // Strategy 2: Look up by reference ID from payment link
      try {
        const paymentLinkDetails = await razorpay.paymentLink.fetch(paymentLinkId);
        const referenceId = paymentLinkDetails.reference_id;
        
        if (referenceId) {
          orderDetails = orderStore.get(referenceId);
          console.log(`🔍 [${requestId}] Reference ID lookup result: ${orderDetails ? 'Found' : 'Not found'}`);
        }
      } catch (fetchError) {
        console.error(`❌ [${requestId}] Failed to fetch payment link details:`, fetchError.message);
      }
    }
    
    // Strategy 3: Recovery from Razorpay API
    if (!orderDetails) {
      console.log(`🔍 [${requestId}] Order not found, attempting recovery from Razorpay API...`);
      
      try {
        const paymentLinkDetails = await razorpay.paymentLink.fetch(paymentLinkId);
        
        if (paymentLinkDetails.notes && paymentLinkDetails.notes.ref_id) {
          console.log(`🔍 [${requestId}] Found reference ID in notes: ${paymentLinkDetails.notes.ref_id}`);
          
          // Try to find order by reference ID
          const refOrderDetails = orderStore.get(paymentLinkDetails.notes.ref_id);
          if (refOrderDetails) {
            console.log(`✅ [${requestId}] Recovered order data using reference ID`);
            orderDetails = refOrderDetails;
            orderDetails.recovered = true;
            orderDetails.recoveredAt = new Date().toISOString();
          } else {
            console.error(`❌ [${requestId}] Order not found even with reference ID: ${paymentLinkDetails.notes.ref_id}`);
            
            // Create minimal order details for basic processing
            const sanitizedCustomerName = sanitizeName(paymentLinkDetails.notes.customer || 'Customer');
            
            orderDetails = {
              bookingData: {
                bookingName: sanitizedCustomerName,
                NameUser: sanitizedCustomerName,
                totalAmount: paymentLinkDetails.amount / 100,
                advanceAmount: paymentLinkDetails.amount / 100,
                remainingAmount: 0,
                source: 'minimal_recovery',
                recoveredAt: new Date().toISOString(),
                paymentLinkId: paymentLinkId,
                reference_id: paymentLinkDetails.reference_id,
                occasion: sanitizeForRazorpay(paymentLinkDetails.notes.occasion || 'Celebration'),
                email: '',
                address: '',
                whatsapp: '',
                people: 1,
                wantDecoration: 'Yes',
                extraDecorations: [],
                slotType: 'deluxe'
              },
              amount: paymentLinkDetails.amount / 100,
              status: "created",
              type: "payment_link",
              createdAt: new Date(),
              reference_id: paymentLinkDetails.reference_id,
              paymentLinkId: paymentLinkId,
              recovered: true,
              minimal: true
            };
            
            console.log(`⚠️ [${requestId}] Created minimal order details for processing`);
          }
        } else {
          console.error(`❌ [${requestId}] No reference ID found in payment link notes`);
          return;
        }
      } catch (recoveryError) {
        console.error(`❌ [${requestId}] Recovery attempt failed:`, recoveryError.message);
        return;
      }
    }
    
    if (!orderDetails) {
      console.error(`❌ [${requestId}] Could not find or recover order details for payment link: ${paymentLinkId}`);
      return;
    }
    
    console.log(`✅ [${requestId}] Order details found/recovered successfully`);
    
    // Prepare enhanced booking data
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentId,
      orderId: paymentEntity.order_id,
      paymentLinkId: paymentLinkId,
      totalAmount: orderDetails.bookingData.totalAmount,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId,
      recovered: orderDetails.recovered || false
    };

    const paymentDetails = {
      razorpay_payment_id: paymentId,
      razorpay_order_id: paymentEntity.order_id,
      payment_link_id: paymentLinkId,
    };

    // 🎯 CRITICAL: Single data save with enhanced duplicate prevention
    const saveResult = await saveBookingDataOnce(
      bookingDataWithPayment, 
      paymentDetails, 
      requestId, 
      'payment_link.paid'
    );

    if (saveResult.status === 'duplicate_prevented') {
      console.log(`🚫 [${requestId}] Duplicate save prevented for payment link: ${paymentLinkId}`);
      return;
    }

    // Update order status
    orderDetails.status = "paid";
    orderDetails.paymentEntity = paymentEntity;
    orderDetails.dataStored = saveResult.dataStored;
    orderDetails.savedBooking = saveResult.savedBooking;
    orderDetails.processedAt = new Date().toISOString();
    orderDetails.webhookRequestId = requestId;
    
    // Store with multiple keys for better lookup
    orderStore.set(paymentLinkId, orderDetails);
    if (orderDetails.reference_id) {
      orderStore.set(orderDetails.reference_id, orderDetails);
    }
    
    // Log success
    if (saveResult.status === 'success') {
      console.log(`✅ [${requestId}] 🎯 SINGLE SAVE SUCCESS: Data saved to both Firebase and Sheets (payment_link.paid)`);
    } else if (saveResult.status === 'partial') {
      console.log(`⚠️ [${requestId}] 🎯 SINGLE SAVE PARTIAL: Data saved partially (payment_link.paid)`);
    } else {
      console.log(`❌ [${requestId}] 🎯 SINGLE SAVE FAILURE: Data not saved (payment_link.paid)`);
    }
    
    console.log(`✅ [${requestId}] Payment link processing completed`);
  } catch (error) {
    console.error(`❌ [${requestId}] Payment link processing failed:`, error);
  }
};

// Enhanced payment captured handler (for non-payment-link payments only)
const handlePaymentCaptured = async (paymentEntity, requestId) => {
  try {
    const paymentId = paymentEntity.id;
    const orderId = paymentEntity.order_id;
    const paymentLinkId = paymentEntity.payment_link_id;
    
    console.log(`💰 [${requestId}] Processing payment captured:`, {
      paymentId,
      orderId,
      paymentLinkId
    });
    
    // 🎯 CRITICAL: Check for duplicates
    if (isAlreadyProcessed(paymentId, paymentLinkId)) {
      trackDuplicateAttempt(paymentId, paymentLinkId, 'payment.captured');
      console.log(`🚫 [${requestId}] DUPLICATE PREVENTED: Payment ${paymentId} already processed`);
      return;
    }
    
    // Handle regular order payments only
    let orderDetails = null;
    
    if (orderId) {
      orderDetails = orderStore.get(orderId);
    }
    
    if (!orderDetails) {
      console.log(`⚠️ [${requestId}] Order data not found for regular payment: ${paymentId}`);
      return;
    }
    
    // Process regular payment
    const bookingDataWithPayment = {
      ...orderDetails.bookingData,
      paymentId: paymentId,
      orderId: orderId,
      paymentLinkId: paymentLinkId,
      totalAmount: orderDetails.bookingData.totalAmount,
      advanceAmount: orderDetails.amount,
      remainingAmount: orderDetails.bookingData.totalAmount - orderDetails.amount,
      webhookProcessedAt: new Date().toISOString(),
      webhookRequestId: requestId
    };

    const paymentDetails = {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      payment_link_id: paymentLinkId,
    };

    // 🎯 CRITICAL: Single data save with enhanced duplicate prevention
    const saveResult = await saveBookingDataOnce(
      bookingDataWithPayment, 
      paymentDetails, 
      requestId, 
      'payment.captured'
    );

    if (saveResult.status === 'duplicate_prevented') {
      console.log(`🚫 [${requestId}] Duplicate save prevented for regular payment: ${paymentId}`);
      return;
    }

    // Update order status
    orderDetails.status = "paid";
    orderDetails.paymentId = paymentId;
    orderDetails.dataStored = saveResult.dataStored;
    orderDetails.processedAt = new Date().toISOString();
    orderStore.set(orderId, orderDetails);

    console.log(`✅ [${requestId}] Regular payment processing completed`);
  } catch (error) {
    console.error(`❌ [${requestId}] Payment captured processing failed:`, error);
  }
};

// Enhanced payment failure handler
const handlePaymentFailed = async (paymentEntity, requestId) => {
  try {
    const paymentId = paymentEntity.id;
    const orderId = paymentEntity.order_id;
    const paymentLinkId = paymentEntity.payment_link_id;
    
    console.log(`❌ [${requestId}] Payment failed:`, {
      paymentId,
      orderId,
      paymentLinkId
    });

    // Update order status for both types
    const lookupKey = paymentLinkId || orderId;
    const orderDetails = orderStore.get(lookupKey);
    
    if (orderDetails) {
      orderDetails.status = "failed";
      orderDetails.error = "Payment failed";
      orderDetails.failedAt = new Date().toISOString();
      orderStore.set(lookupKey, orderDetails);
    }
  } catch (error) {
    console.error(`❌ [${requestId}] Payment failure handling error:`, error);
  }
};

// Enhanced payment status endpoint
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
          bookingData: orderDetails.savedBooking,
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
        bookingData: orderDetails.savedBooking,
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

// 🎯 CRITICAL: Enhanced backup data save endpoint with strict duplicate prevention
app.post("/save-backup-data", async (req, res) => {
  try {
    const { bookingData, paymentId, orderId } = req.body;
    
    if (!bookingData) {
      return res.status(400).json({ error: "Booking data required" });
    }
    
    console.log(`💾 Backup data save requested for payment: ${paymentId}`);
    
    const paymentLinkId = bookingData.paymentLinkId;
    
    // 🎯 CRITICAL: Check if data was already saved by webhook
    if (isAlreadyProcessed(paymentId, paymentLinkId)) {
      const existingInfo = processedPayments.get(paymentId) || processedPayments.get(`plink_${paymentLinkId}`);
      console.log(`🚫 Backup save prevented - data already saved by ${existingInfo?.context || 'unknown'} at ${existingInfo?.timestamp || 'unknown time'}`);
      return res.json({ 
        status: "already_saved", 
        message: `Data already saved by ${existingInfo?.context || 'webhook'}`,
        skipped: true,
        originalContext: existingInfo?.context,
        originalTimestamp: existingInfo?.timestamp
      });
    }
    
    // 🎯 NEW: Additional check for payment link payments via Razorpay API
    if (paymentLinkId && paymentLinkId.startsWith('plink_')) {
      try {
        console.log(`🔍 Checking payment link status before backup save...`);
        const paymentLink = await razorpay.paymentLink.fetch(paymentLinkId);
        
        if (paymentLink.status === "paid") {
          // Double-check if webhook might have processed it
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          
          if (isAlreadyProcessed(paymentId, paymentLinkId)) {
            const existingInfo = processedPayments.get(paymentId) || processedPayments.get(`plink_${paymentLinkId}`);
            console.log(`🚫 Backup save prevented after double-check - webhook processed during verification`);
            return res.json({ 
              status: "already_saved", 
              message: "Data saved by webhook during verification",
              skipped: true,
              originalContext: existingInfo?.context,
              originalTimestamp: existingInfo?.timestamp
            });
          }
        }
      } catch (apiError) {
        console.error(`⚠️ Could not verify payment link status for backup save:`, apiError.message);
      }
    }
    
    // Ensure we have the payment details
    const enhancedBookingData = {
      ...bookingData,
      paymentId: paymentId,
      orderId: orderId,
      backupSavedAt: new Date().toISOString(),
      source: 'thankyou_page_backup'
    };

    const paymentDetails = {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      payment_link_id: paymentLinkId,
    };

    console.log(`🔄 Processing backup save for: ${bookingData.bookingName || 'Unknown'}`);

    // 🎯 CRITICAL: Use single data save function with backup context
    const saveResult = await saveBookingDataOnce(
      enhancedBookingData, 
      paymentDetails, 
      'backup_' + Date.now(), 
      'thankyou_page_backup'
    );

    if (saveResult.status === 'duplicate_prevented') {
      return res.json({ 
        status: "already_saved", 
        message: `Data already saved by ${saveResult.originalContext}`,
        skipped: true,
        originalContext: saveResult.originalContext
      });
    }

    if (saveResult.status === 'success') {
      console.log(`✅ BACKUP SUCCESS: Data saved to both Firebase and Sheets`);
      res.json({ 
        status: "success", 
        message: "Backup data saved successfully",
        dataStored: saveResult.dataStored
      });
    } else if (saveResult.status === 'partial') {
      console.log(`⚠️ BACKUP PARTIAL: Data saved partially`);
      res.json({ 
        status: "partial", 
        message: "Backup data partially saved",
        dataStored: saveResult.dataStored
      });
    } else {
      console.log(`❌ BACKUP FAILED: Data not saved to either service`);
      res.status(500).json({ 
        status: "failed", 
        message: "Failed to save backup data",
        dataStored: saveResult.dataStored
      });
    }
  } catch (error) {
    console.error("❌ Backup data save failed:", error);
    res.status(500).json({ 
      error: "Backup save failed", 
      details: error.message 
    });
  }
});

// Enhanced payment recovery endpoint
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
        
        // 🎯 CRITICAL: Check if already processed
        if (isAlreadyProcessed(payment.id, paymentLinkId)) {
          const existingInfo = processedPayments.get(payment.id) || processedPayments.get(`plink_${paymentLinkId}`);
          console.log(`ℹ️ Payment ${payment.id} already processed by ${existingInfo?.context} - no recovery needed`);
          return res.json({ 
            status: "already_processed", 
            message: `Payment already processed by ${existingInfo?.context || 'webhook'}`,
            paymentId: payment.id,
            originalContext: existingInfo?.context,
            originalTimestamp: existingInfo?.timestamp
          });
        }
        
        // Use provided booking data or create minimal data
        const recoveryBookingData = bookingData || {
          bookingName: sanitizeName(paymentLink.notes?.customer || 'Customer'),
          NameUser: sanitizeName(paymentLink.notes?.customer || 'Customer'),
          totalAmount: paymentLink.amount / 100,
          advanceAmount: paymentLink.amount / 100,
          remainingAmount: 0,
          source: 'recovery_minimal',
          occasion: sanitizeForRazorpay(paymentLink.notes?.occasion || 'Celebration'),
          email: '',
          address: '',
          whatsapp: '',
          people: 1,
          wantDecoration: 'Yes',
          extraDecorations: [],
          slotType: 'deluxe'
        };
        
        // Process the payment manually with recovery data
        const bookingDataWithPayment = {
          ...recoveryBookingData,
          paymentId: payment.id,
          orderId: payment.order_id,
          paymentLinkId: paymentLinkId,
          advanceAmount: paymentLink.amount / 100,
          remainingAmount: Math.max(0, (recoveryBookingData.totalAmount || 0) - (paymentLink.amount / 100)),
          totalAmount: recoveryBookingData.totalAmount || paymentLink.amount / 100,
          recoveredAt: new Date().toISOString(),
          source: 'manual_recovery'
        };

        const paymentDetails = {
          razorpay_payment_id: payment.id,
          razorpay_order_id: payment.order_id,
          payment_link_id: paymentLinkId,
        };

        console.log(`💾 Processing recovery save...`);

        // 🎯 CRITICAL: Use single data save function with recovery context
        const saveResult = await saveBookingDataOnce(
          bookingDataWithPayment, 
          paymentDetails, 
          'recovery_' + Date.now(), 
          'manual_recovery'
        );

        if (saveResult.status === 'duplicate_prevented') {
          return res.json({ 
            status: "already_processed", 
            message: `Payment already processed by ${saveResult.originalContext}`,
            paymentId: payment.id,
            originalContext: saveResult.originalContext
          });
        }

        console.log(`✅ Payment recovery completed:`, saveResult);
        
        res.json({
          status: "recovered",
          paymentId: payment.id,
          dataStored: saveResult.dataStored
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

// Enhanced cleanup with better TTL management
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  const keysToDelete = [];

  for (const [id, orderDetails] of orderStore.entries()) {
    const shouldClean = orderDetails.expiresAt && now > orderDetails.expiresAt;
    
    if (shouldClean) {
      keysToDelete.push(id);
      cleanedCount++;
    }
  }

  // Delete expired orders
  keysToDelete.forEach(key => orderStore.delete(key));
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired orders`);
  }
  
  // Clean up processed payments older than 24 hours
  const processedPaymentsCopy = new Map(processedPayments);
  for (const [paymentId, info] of processedPaymentsCopy) {
    const processedTime = new Date(info.timestamp);
    const hoursDiff = (now - processedTime) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      processedPayments.delete(paymentId);
    }
  }
  
  // Clean up duplicate attempts older than 24 hours
  const duplicateAttemptsCopy = new Map(duplicateAttempts);
  for (const [key, attempts] of duplicateAttemptsCopy) {
    const filteredAttempts = attempts.filter(attempt => {
      const attemptTime = new Date(attempt.timestamp);
      const hoursDiff = (now - attemptTime) / (1000 * 60 * 60);
      return hoursDiff <= 24;
    });
    
    if (filteredAttempts.length === 0) {
      duplicateAttempts.delete(key);
    } else {
      duplicateAttempts.set(key, filteredAttempts);
    }
  }
  
}, 30 * 60 * 1000); // Run every 30 minutes

// Enhanced health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStore.size,
    processedPayments: processedPayments.size,
    duplicateAttempts: duplicateAttempts.size,
    version: "4.0 - Ultimate Duplicate Prevention",
    environment: process.env.NODE_ENV || 'development',
    features: {
      webhookSignatureVerification: true,
      multipleOrderLookup: true,
      dataRecovery: true,
      retryLogic: true,
      ultimateDuplicateProtection: true, // 🎯 ENHANCED
      singleDataSaveOnly: true,
      backupDataEndpoint: true,
      thankyouPageBackup: true,
      webhookErrorRecovery: true,
      webhookOnlyDataSave: true,
      dualEventProtection: true,
      enhancedDuplicateTracking: true, // 🎯 NEW
      paymentIdTimestamps: true, // 🎯 NEW
      contextualSaveTracking: true, // 🎯 NEW
      duplicateAttemptMonitoring: true // 🎯 NEW
    }
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
      dataStored: order.dataStored,
      recovered: order.recovered || false
    }));
    
    res.json({ 
      orders, 
      count: orders.length,
      processedPayments: processedPayments.size,
      duplicateAttempts: duplicateAttempts.size
    });
  });
  
  // 🎯 NEW: Enhanced debug endpoint for processed payments
  app.get("/debug/processed-payments", (req, res) => {
    const processed = Array.from(processedPayments.entries()).map(([id, info]) => ({
      id,
      timestamp: info.timestamp,
      context: info.context,
      paymentLinkId: info.paymentLinkId,
      paymentId: info.paymentId
    }));
    
    res.json({ 
      processedPayments: processed,
      count: processedPayments.size
    });
  });
  
  // 🎯 NEW: Debug endpoint for duplicate attempts
  app.get("/debug/duplicate-attempts", (req, res) => {
    const attempts = Array.from(duplicateAttempts.entries()).map(([key, attemptList]) => ({
      key,
      attempts: attemptList,
      count: attemptList.length
    }));
    
    res.json({ 
      duplicateAttempts: attempts,
      totalKeys: duplicateAttempts.size
    });
  });
}

// Test endpoint for webhook
app.post("/test-webhook", (req, res) => {
  console.log("🧪 Test webhook received:", req.body);
  res.json({ status: "test_received", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Server v4.0 running on port ${PORT}`);
  console.log(`📡 Payment Links API Ready`);
  console.log(`🔗 Webhook endpoint: /webhook`);
  console.log(`🔄 Recovery endpoint: /recover-payment`);
  console.log(`💾 Backup data endpoint: /save-backup-data`);
  console.log(`📊 Health check: /health`);
  console.log(`🧪 Test webhook: /test-webhook`);
  console.log(`✅ 🎯 ULTIMATE DUPLICATE PREVENTION SYSTEM v4.0:`);
  console.log(`   • ❌ DISABLED: Immediate data save on payment link creation`);
  console.log(`   • ✅ ENABLED: Single data save only via webhook after payment`);
  console.log(`   • ✅ ENABLED: Enhanced payment ID tracking with timestamps`);
  console.log(`   • ✅ ENABLED: Payment link ID tracking in processed payments`);
  console.log(`   • ✅ ENABLED: Contextual save tracking (webhook/backup/recovery)`);
  console.log(`   • ✅ ENABLED: Duplicate attempt monitoring and logging`);
  console.log(`   • ✅ ENABLED: Multiple duplicate prevention strategies`);
  console.log(`   • ✅ ENABLED: Enhanced backup save duplicate prevention`);
  console.log(`   • ✅ ENABLED: Recovery endpoint duplicate prevention`);
  console.log(`   • ✅ ENABLED: Payment.captured event filtering for payment links`);
  console.log(`   • 🎯 CRITICAL: Data saved EXACTLY ONCE when payment is completed`);
  console.log(`   • 🎯 NEW: Ultimate duplicate prevention with Map-based tracking`);
  console.log(`   • 🎯 NEW: Enhanced debug endpoints for monitoring duplicates`);
});
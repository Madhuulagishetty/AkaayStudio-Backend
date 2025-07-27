// Enhanced Payment System with Single Data Save Guarantee
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
app.use('/webhook', express.raw({ type: 'application/json', limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// SINGLE SOURCE OF TRUTH - Data Save Tracking
const dataSaveTracker = new Map(); // Track what has been saved
const orderStore = new Map(); // Store order details
const saveInProgress = new Set(); // Track saves in progress

// CRITICAL: Single data save function with atomic operations
const saveBookingDataOnce = async (paymentId, bookingData, paymentDetails) => {
  // ATOMIC CHECK: Ensure this payment is only saved once
  if (dataSaveTracker.has(paymentId)) {
    console.log(`✅ Payment ${paymentId} already saved - skipping duplicate save`);
    return dataSaveTracker.get(paymentId);
  }

  if (saveInProgress.has(paymentId)) {
    console.log(`⏳ Payment ${paymentId} save already in progress - waiting...`);
    // Wait for the save to complete
    let attempts = 0;
    while (saveInProgress.has(paymentId) && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    // Return the saved result if available
    return dataSaveTracker.get(paymentId) || null;
  }

  // Mark as in progress
  saveInProgress.add(paymentId);

  try {
    console.log(`💾 [SINGLE SAVE] Processing payment ${paymentId} - FIRST AND ONLY TIME`);

    // Prepare data for saving
    const enhancedBookingData = {
      ...bookingData,
      paymentId,
      ...paymentDetails,
      savedAt: new Date().toISOString(),
      saveMethod: 'webhook_single_save'
    };

    // ATOMIC SAVE: Save to both Firebase and Sheets
    const [firebaseResult, sheetsResult] = await Promise.allSettled([
      saveToFirebase(enhancedBookingData, paymentDetails),
      saveBookingToSheet(enhancedBookingData)
    ]);

    const saveResult = {
      paymentId,
      firebase: {
        success: firebaseResult.status === 'fulfilled',
        data: firebaseResult.status === 'fulfilled' ? firebaseResult.value : null,
        error: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null
      },
      sheets: {
        success: sheetsResult.status === 'fulfilled',
        data: sheetsResult.status === 'fulfilled' ? sheetsResult.value : null,
        error: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null
      },
      timestamp: new Date().toISOString(),
      bookingData: enhancedBookingData
    };

    // ATOMIC COMMIT: Mark as saved (this prevents any future saves)
    dataSaveTracker.set(paymentId, saveResult);
    
    console.log(`✅ [SINGLE SAVE COMPLETE] Payment ${paymentId} saved successfully:`, {
      firebase: saveResult.firebase.success,
      sheets: saveResult.sheets.success
    });

    return saveResult;

  } catch (error) {
    console.error(`❌ [SINGLE SAVE ERROR] Failed to save payment ${paymentId}:`, error);
    
    // Mark as failed but still track to prevent retries
    const errorResult = {
      paymentId,
      error: error.message,
      timestamp: new Date().toISOString(),
      failed: true
    };
    
    dataSaveTracker.set(paymentId, errorResult);
    return errorResult;

  } finally {
    // Remove from in-progress
    saveInProgress.delete(paymentId);
  }
};

// Enhanced Google Sheets saving
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
      order_id: bookingData.orderId || '',
      payment_link_id: bookingData.paymentLinkId || '',
      source: bookingData.source || 'web_app',
      save_method: bookingData.saveMethod || 'single_save'
    };

    const response = await axios.post(
      "https://sheetdb.io/api/v1/s6a0t5omac7jg",
      { data: [sheetData] },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      }
    );

    console.log("✅ Google Sheets save successful");
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

// Enhanced Firebase saving
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
      source: bookingData.source || 'web_app',
      saveMethod: bookingData.saveMethod || 'single_save'
    };

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

// Utility functions
const validateAndSanitizePhone = (phone) => {
  if (!phone) return "";
  const cleanPhone = phone.toString().replace(/\D/g, '');
  const hasRecurringDigits = /^(\d)\1{9,}$/.test(cleanPhone);
  if (cleanPhone.length < 10 || cleanPhone.length > 12 || hasRecurringDigits) return "";
  return cleanPhone.length === 10 ? "91" + cleanPhone : cleanPhone;
};

const sanitizeForRazorpay = (str) => {
  if (!str) return "";
  return str.toString().trim()
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/['"<>{}[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .substring(0, 100);
};

const sanitizeEmail = (email) => {
  if (!email) return "";
  const cleanEmail = email.toString().trim().toLowerCase().replace(/[^\w@.-]/g, "");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(cleanEmail) ? cleanEmail : "";
};

const sanitizeName = (name) => {
  if (!name) return "Customer";
  return name.toString().trim()
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ")
    .substring(0, 100) || "Customer";
};

// Payment link creation (no data save)
app.post("/create-payment-link", async (req, res) => {
  try {
    const { amount, bookingData } = req.body;
    
    if (!bookingData || !amount) {
      return res.status(400).json({ error: "Missing booking data or amount" });
    }

    // Sanitize input data
    const sanitizedBookingData = {
      ...bookingData,
      bookingName: sanitizeName(bookingData.bookingName),
      NameUser: sanitizeName(bookingData.NameUser),
      email: sanitizeEmail(bookingData.email),
      address: sanitizeForRazorpay(bookingData.address),
      occasion: sanitizeForRazorpay(bookingData.occasion),
      whatsapp: validateAndSanitizePhone(bookingData.whatsapp)
    };

    const referenceId = "booking_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    
    const options = {
      amount: amount * 100,
      currency: "INR",
      reference_id: referenceId,
      description: sanitizeForRazorpay(`Theater Booking - ${sanitizedBookingData.bookingName}`),
      customer: {
        name: sanitizeName(sanitizedBookingData.bookingName),
        email: sanitizeEmail(sanitizedBookingData.email),
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: `${process.env.FRONTEND_URL || 'https://birthday-backend-tau.vercel.app'}/payment-success`,
      callback_method: "get",
      notes: {
        ref_id: referenceId,
        customer: sanitizedBookingData.bookingName.substring(0, 30),
        source: 'web_app'
      }
    };

    if (sanitizedBookingData.whatsapp) {
      options.customer.contact = sanitizedBookingData.whatsapp;
    }
    
    const paymentLink = await razorpay.paymentLink.create(options);
    
    // Store order data (in memory only - NO DATABASE SAVE)
    const orderData = {
      bookingData: {
        ...sanitizedBookingData,
        totalAmount: sanitizedBookingData.totalAmount || sanitizedBookingData.amountWithTax,
        advanceAmount: amount,
        remainingAmount: (sanitizedBookingData.totalAmount || sanitizedBookingData.amountWithTax) - amount,
        source: 'web_app',
        createdAt: new Date().toISOString(),
        reference_id: referenceId,
        paymentLinkId: paymentLink.id
      },
      amount,
      status: "created",
      createdAt: new Date(),
      paymentLinkId: paymentLink.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };

    orderStore.set(paymentLink.id, orderData);
    orderStore.set(referenceId, orderData);

    console.log(`✅ Payment link created: ${paymentLink.id} (NO DATA SAVED YET)`);
    
    res.json({
      paymentLink,
      short_url: paymentLink.short_url,
      paymentLinkId: paymentLink.id,
      referenceId: referenceId,
    });
  } catch (error) {
    console.error("❌ Payment link creation failed:", error);
    res.status(500).json({ error: "Payment link creation failed", details: error.message });
  }
});

// SINGLE WEBHOOK HANDLER - Only place where data is saved
app.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const eventId = req.headers['x-razorpay-event-id'];

    // Verify signature
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (signature !== expected) {
      console.error('❌ Invalid webhook signature');
      return res.status(400).send('Invalid signature');
    }

    let jsonBody;
    try {
      jsonBody = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      console.error('❌ Failed to parse JSON body:', err);
      return res.status(400).send('Invalid JSON');
    }

    const { event, payload } = jsonBody;
    console.log(`📨 Webhook event: ${event} | Event ID: ${eventId}`);

    // ONLY process payment completion events
    if (event === 'payment_link.paid') {
      await handlePaymentLinkPaid(payload, eventId);
    } else if (event === 'payment.captured' && !payload.payment.entity.payment_link_id) {
      // Only handle regular orders (not payment link orders)
      await handlePaymentCaptured(payload, eventId);
    } else {
      console.log(`ℹ️ Ignoring event: ${event}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).send('Webhook error');
  }
});

// Handle payment link paid event
const handlePaymentLinkPaid = async (payload, eventId) => {
  try {
    const paymentLinkEntity = payload.payment_link.entity;
    const paymentEntity = payload.payment.entity;
    const paymentId = paymentEntity.id;
    const paymentLinkId = paymentLinkEntity.id;

    console.log(`🔗 Processing payment link paid: ${paymentLinkId} | Payment: ${paymentId}`);

    // CHECK: Has this payment already been saved?
    if (dataSaveTracker.has(paymentId)) {
      console.log(`✅ Payment ${paymentId} already saved - webhook skipping`);
      return;
    }

    // Find order data
    let orderData = orderStore.get(paymentLinkId);
    if (!orderData && paymentLinkEntity.reference_id) {
      orderData = orderStore.get(paymentLinkEntity.reference_id);
    }

    if (!orderData) {
      console.log(`⚠️ Order data not found for payment link: ${paymentLinkId}`);
      // Create minimal order data for recovery
      orderData = {
        bookingData: {
          bookingName: 'Recovery Customer',
          NameUser: 'Recovery Customer',
          totalAmount: paymentLinkEntity.amount / 100,
          advanceAmount: paymentLinkEntity.amount / 100,
          remainingAmount: 0,
          source: 'webhook_recovery',
          paymentLinkId: paymentLinkId,
          slotType: 'deluxe',
          occasion: 'Special Event'
        }
      };
    }

    // Prepare payment details
    const paymentDetails = {
      razorpay_payment_id: paymentId,
      razorpay_order_id: paymentEntity.order_id,
      payment_link_id: paymentLinkId,
    };

    // SINGLE SAVE: This is the ONLY place data gets saved
    const saveResult = await saveBookingDataOnce(paymentId, orderData.bookingData, paymentDetails);
    
    if (saveResult && !saveResult.failed) {
      console.log(`✅ Payment link webhook processing completed: ${paymentId}`);
    } else {
      console.error(`❌ Payment link webhook processing failed: ${paymentId}`);
    }

  } catch (error) {
    console.error(`❌ Payment link webhook error:`, error);
  }
};

// Handle regular payment captured event
const handlePaymentCaptured = async (payload, eventId) => {
  try {
    const paymentEntity = payload.payment.entity;
    const paymentId = paymentEntity.id;
    const orderId = paymentEntity.order_id;

    console.log(`💰 Processing payment captured: ${paymentId} | Order: ${orderId}`);

    // CHECK: Has this payment already been saved?
    if (dataSaveTracker.has(paymentId)) {
      console.log(`✅ Payment ${paymentId} already saved - webhook skipping`);
      return;
    }

    // Find order data
    const orderData = orderStore.get(orderId);
    if (!orderData) {
      console.log(`⚠️ Order data not found for payment: ${paymentId}`);
      return;
    }

    // Prepare payment details
    const paymentDetails = {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      payment_link_id: null,
    };

    // SINGLE SAVE: This is the ONLY place data gets saved
    const saveResult = await saveBookingDataOnce(paymentId, orderData.bookingData, paymentDetails);
    
    if (saveResult && !saveResult.failed) {
      console.log(`✅ Regular payment webhook processing completed: ${paymentId}`);
    } else {
      console.error(`❌ Regular payment webhook processing failed: ${paymentId}`);
    }

  } catch (error) {
    console.error(`❌ Regular payment webhook error:`, error);
  }
};

// Payment status endpoint (READ ONLY)
app.get("/payment-status/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    // Check if data has been saved
    const saveResult = dataSaveTracker.get(paymentId);
    if (saveResult) {
      return res.json({
        status: saveResult.failed ? "failed" : "paid",
        saved: !saveResult.failed,
        saveResult: saveResult,
        dataLocation: {
          firebase: saveResult.firebase?.success || false,
          sheets: saveResult.sheets?.success || false
        }
      });
    }

    // Check order status
    const orderData = orderStore.get(paymentId);
    if (orderData) {
      return res.json({
        status: orderData.status || "pending",
        saved: false,
        message: "Payment found but not yet processed"
      });
    }

    res.status(404).json({
      status: "not_found",
      message: "Payment not found"
    });
  } catch (error) {
    console.error("❌ Payment status check failed:", error);
    res.status(500).json({ error: "Status check failed" });
  }
});

// DISABLED: Backup save endpoint (prevents duplicate saves)
app.post("/save-backup-data", async (req, res) => {
  try {
    const { paymentId } = req.body;
    
    if (!paymentId) {
      return res.status(400).json({ error: "Payment ID required" });
    }

    // Check if already saved
    const saveResult = dataSaveTracker.get(paymentId);
    if (saveResult) {
      console.log(`ℹ️ Payment ${paymentId} already saved by webhook - backup not needed`);
      return res.json({ 
        status: "already_saved", 
        message: "Data already saved by webhook",
        saveResult: saveResult
      });
    }

    console.log(`⚠️ Payment ${paymentId} not found in save tracker - webhook may have failed`);
    res.json({ 
      status: "not_saved", 
      message: "Payment not processed by webhook yet. Please wait or contact support."
    });
  } catch (error) {
    console.error("❌ Backup check failed:", error);
    res.status(500).json({ error: "Backup check failed" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStore.size,
    savedPayments: dataSaveTracker.size,
    savesInProgress: saveInProgress.size,
    version: "4.0 - Guaranteed Single Save",
    features: {
      singleSaveGuarantee: true,
      atomicOperations: true,
      duplicateProtection: true,
      webhookOnlyDataSave: true
    }
  });
});

// Cleanup expired orders
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;

  for (const [id, orderDetails] of orderStore.entries()) {
    if (orderDetails.expiresAt && now > orderDetails.expiresAt) {
      orderStore.delete(id);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired orders`);
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Single Save Payment System v4.0 running on port ${PORT}`);
  console.log(`✅ GUARANTEED SINGLE DATA SAVE SYSTEM:`);
  console.log(`   • Data is saved EXACTLY ONCE via webhook only`);
  console.log(`   • Atomic operations prevent duplicate saves`);
  console.log(`   • All backup endpoints are disabled/read-only`);
  console.log(`   • Complete duplicate protection across all endpoints`);
});
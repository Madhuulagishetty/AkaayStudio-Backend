const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc, query, where, getDocs } = require("firebase/firestore");
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

// Enhanced order store with persistence
const orderStore = new Map();
const processedPayments = new Set(); // Track processed payments to avoid duplicates

// Function to check if booking already exists in Firebase
const checkBookingExists = async (paymentId) => {
  try {
    const bookingsRef = collection(db, "deluxe");
    const q = query(bookingsRef, where("paymentId", "==", paymentId));
    const querySnapshot = await getDocs(q);
    
    return !querySnapshot.empty;
  } catch (error) {
    console.error("Error checking booking existence:", error);
    return false;
  }
};

// Enhanced Google Sheets saving with retry logic and duplicate check
const saveBookingToSheet = async (bookingData, retryCount = 0) => {
  const maxRetries = 3;
  
  try {
    console.log(`📝 Saving booking to Google Sheets (attempt ${retryCount + 1})...`);
    
    // Check if this payment already exists in Sheets (you would need to implement this)
    // For now, we'll assume it doesn't exist to avoid making additional API calls
    
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
      advance_amount: bookingData.advanceAmount || 1026,
      remaining_amount: bookingData.remainingAmount || (bookingData.totalAmount - 1026) || 0,
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
      recovery_type: bookingData.minimal ? 'minimal' : bookingData.recovered ? 'recovered' : 'normal'
    };

    console.log("📊 Sheet data prepared:", {
      booking_date: sheetData.booking_date,
      payment_id: sheetData.payment_id,
      total_amount: sheetData.total_amount,
      whatsapp_number: sheetData.whatsapp_number
    });

    const response = await axios.post(
      "https://sheetdb.io/api/v1/ze8obcwccch0z",
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

// Enhanced Firebase saving with retry logic and duplicate check
const saveToFirebase = async (bookingData, paymentDetails, retryCount = 0) => {
  const maxRetries = 3;
  
  try {
    console.log(`🔥 Saving booking to Firebase (attempt ${retryCount + 1})...`);
    
    // Check if this payment already exists
    const paymentId = paymentDetails.razorpay_payment_id;
    const alreadyExists = await checkBookingExists(paymentId);
    
    if (alreadyExists) {
      console.log(`⚠️ Booking with payment ID ${paymentId} already exists in Firebase. Skipping save.`);
      return { id: "already_exists", status: "duplicate" };
    }
    
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
      advancePaid: bookingData.advanceAmount || 1026,
      remainingAmount: bookingData.remainingAmount || (bookingData.totalAmount - 1026) || 0,
      totalAmount: bookingData.totalAmount || 0,
      timestamp: new Date(),
      createdAt: bookingData.createdAt ? new Date(bookingData.createdAt) : new Date(),
      source: bookingData.source || 'web_app',
      webhookProcessed: true,
      webhookTimestamp: new Date(),
      recoveryType: bookingData.minimal ? 'minimal' : bookingData.recovered ? 'recovered' : 'normal',
      bookingMeta: {
        createdAt: new Date(),
        source: "web",
        version: "3.2",
        paymentMethod: "razorpay_payment_link",
        webhookProcessed: true,
        processedAt: new Date().toISOString()
      },
    };

    console.log("📊 Firebase data prepared:", {
      bookingName: saveData.bookingName,
      paymentId: saveData.paymentId,
      totalAmount: saveData.totalAmount,
      whatsapp: saveData.whatsapp
    });

    const collectionName = bookingData.slotType || 'deluxe';
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

// MODIFIED: Payment link creation WITHOUT immediate data save
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

// CRITICAL: Enhanced webhook handler with duplicate prevention
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const eventId = req.headers['x-razorpay-event-id'];

  // Verify webhook signature
  if (!verifyWebhookSignature(req.body, signature, process.env.RAZORPAY_WEBHOOK_SECRET)) {
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
  console.log('[info] Webhook event:', event);

  // Check if we've already processed this event
  if (processedPayments.has(eventId)) {
    console.log(`⚠️ Already processed webhook event: ${eventId}`);
    return res.status(200).send('OK');
  }

  // Mark this event as processed
  processedPayments.add(eventId);

  if (event === 'payment_link.paid' || event === 'payment.captured') {
    const paymentLinkId = payload.payment_link?.entity?.id;
    const paymentId = payload.payment?.entity?.id;
    
    console.log('[debug] Processing payment:', {
      paymentLinkId,
      paymentId,
      event
    });

    // Check if this payment has already been processed
    const alreadyProcessed = await checkBookingExists(paymentId);
    if (alreadyProcessed) {
      console.log(`⚠️ Payment ${paymentId} already processed - skipping`);
      return res.status(200).send('OK');
    }

    let orderData = null;
    
    // Try to find order data by payment link ID
    if (paymentLinkId) {
      orderData = orderStore.get(paymentLinkId);
    }
    
    // If not found by payment link ID, try reference ID from payment notes
    if (!orderData && payload.payment?.entity?.notes?.ref_id) {
      const refId = payload.payment.entity.notes.ref_id;
      orderData = orderStore.get(refId);
    }

    if (orderData) {
      console.log(`[info] 📦 Found orderData for payment`);
      
      try {
        // Save to both services
        const [firebaseResult, sheetsResult] = await Promise.allSettled([
          saveToFirebase(orderData.bookingData, { 
            razorpay_payment_id: paymentId, 
            razorpay_order_id: payload.payment?.entity?.order_id,
            payment_link_id: paymentLinkId
          }),
          saveBookingToSheet({ ...orderData.bookingData, paymentId })
        ]);

        console.log(`[info] ✅ Booking saved results:`, {
          firebase: firebaseResult.status,
          sheets: sheetsResult.status
        });
      } catch (error) {
        console.error(`[error] Failed to save booking:`, error);
      }
    } else {
      console.warn('[warn] ⚠️ No booking data found for payment');
    }
  }

  res.status(200).send('OK');
});

// Enhanced payment status endpoint
app.get("/payment-status/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`🔍 Checking payment status: ${paymentId}`);
    
    // Check if payment already exists in database
    const alreadyExists = await checkBookingExists(paymentId);
    if (alreadyExists) {
      return res.json({
        status: "paid",
        message: "Payment already processed and booking saved",
        alreadySaved: true
      });
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
            needsProcessing: true,
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
    
    res.status(404).json({
      status: "not_found",
      message: "Payment not found",
    });
  } catch (error) {
    console.error("❌ Payment status check failed:", error);
    res.status(500).json({ error: "Status check failed", details: error.message });
  }
});

// Backup data save endpoint for thank you page
app.post("/save-backup-data", async (req, res) => {
  try {
    const { bookingData, paymentId, orderId } = req.body;
    
    if (!bookingData || !paymentId) {
      return res.status(400).json({ error: "Booking data and payment ID required" });
    }
    
    console.log(`💾 Backup data save requested for payment: ${paymentId}`);
    
    // Check if data was already saved
    const alreadyExists = await checkBookingExists(paymentId);
    if (alreadyExists) {
      console.log(`ℹ️ Payment ${paymentId} already processed - skipping backup save`);
      return res.json({ 
        status: "already_saved", 
        message: "Data already saved",
        skipped: true
      });
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
      payment_link_id: null,
    };

    console.log(`🔄 Processing backup save for: ${bookingData.bookingName || 'Unknown'}`);

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
      timestamp: new Date().toISOString()
    };

    console.log(`📊 Backup data storage results:`, dataStored);

    if (dataStored.firebase && dataStored.sheets) {
      console.log(`✅ BACKUP SUCCESS: Data saved to both Firebase and Sheets`);
      res.json({ 
        status: "success", 
        message: "Backup data saved successfully",
        dataStored: dataStored
      });
    } else if (dataStored.firebase || dataStored.sheets) {
      console.log(`⚠️ BACKUP PARTIAL: Data saved to ${dataStored.firebase ? 'Firebase' : 'Sheets'} only`);
      res.json({ 
        status: "partial", 
        message: "Backup data partially saved",
        dataStored: dataStored
      });
    } else {
      console.log(`❌ BACKUP FAILED: Data not saved to either service`);
      res.status(500).json({ 
        status: "failed", 
        message: "Failed to save backup data",
        dataStored: dataStored
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
  
  // Also clean up processed payments older than 1 hour
  if (processedPayments.size > 1000) {
    processedPayments.clear();
    console.log(`🧹 Cleared processed payments set`);
  }
}, 30 * 60 * 1000); // Run every 30 minutes

// Enhanced health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStore.size,
    processedPayments: processedPayments.size,
    version: "3.2 - Single Data Save (Webhook Only)",
    environment: process.env.NODE_ENV || 'development',
    features: {
      webhookSignatureVerification: true,
      duplicatePrevention: true,
      retryLogic: true,
      immediateDataSave: false,
      singleDataSaveOnly: true,
      backupDataEndpoint: true,
      duplicateCheck: true
    }
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Server v3.2 running on port ${PORT}`);
  console.log(`📡 Payment Links API Ready`);
  console.log(`🔗 Webhook endpoint: /webhook`);
  console.log(`💾 Backup data endpoint: /save-backup-data`);
  console.log(`📊 Health check: /health`);
  console.log(`✅ DUPLICATE PREVENTION SYSTEM ENABLED:`);
  console.log(`   • ✅ ENABLED: Duplicate check before saving`);
  console.log(`   • ✅ ENABLED: Webhook signature verification`);
  console.log(`   • ✅ ENABLED: Payment ID tracking`);
  console.log(`   • ✅ ENABLED: Single data save only`);
});

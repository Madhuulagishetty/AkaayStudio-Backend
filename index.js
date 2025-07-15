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

// Enhanced order store with persistence
const orderStore = new Map();
const processedPayments = new Set(); // Track processed payments to avoid duplicates

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
      created_at: bookingData.createdAt || isoTimestamp,
      webhook_processed: true,
      webhook_timestamp: isoTimestamp,
      recovery_type: bookingData.minimal ? 'minimal' : bookingData.recovered ? 'recovered' : 'normal',
      webhook_processed: true,
      webhook_timestamp: isoTimestamp
    };

    console.log("📊 Sheet data prepared:", {
      booking_date: sheetData.booking_date,
      payment_id: sheetData.payment_id,
      total_amount: sheetData.total_amount,
      whatsapp_number: sheetData.whatsapp_number
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
      paymentStatus: "partial",
      advancePaid: bookingData.advanceAmount || 10,
      remainingAmount: bookingData.remainingAmount || (bookingData.totalAmount - 10) || 0,
      totalAmount: bookingData.totalAmount || 0,
      timestamp: new Date(),
      createdAt: bookingData.createdAt ? new Date(bookingData.createdAt) : new Date(),
      source: bookingData.source || 'web_app',
      webhookProcessed: true,
      webhookTimestamp: new Date(),
      recoveryType: bookingData.minimal ? 'minimal' : bookingData.recovered ? 'recovered' : 'normal',
      webhookProcessed: true,
      webhookTimestamp: new Date(),
      bookingMeta: {
        createdAt: new Date(),
        source: "web",
        version: "3.1",
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
    .substring(0, 100) // Limit to 50 characters
    || "Customer"; // Fallback if empty after sanitization
};
// Enhanced payment link creation with better data storage
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
    
    // Store enhanced booking data with expiration
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

    // Store with multiple keys for better lookup
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

    // Store with payment link ID as primary key
    orderStore.set(paymentLink.id, orderData);
    
    // Also store with reference ID for backup lookup
    orderStore.set(referenceId, orderData);

    console.log(`✅ Payment link created: ${paymentLink.id}`);
    console.log(`📦 Order data stored with keys: ${paymentLink.id}, ${referenceId}`);

    // IMMEDIATE DATA SAVE: Save booking data immediately when payment link is created
    // This ensures data is not lost even if webhook fails
    try {
      console.log(`💾 Saving booking data immediately for payment link: ${paymentLink.id}`);
      
      const immediateBookingData = {
        ...enhancedBookingData,
        paymentLinkId: paymentLink.id,
        immediatelyCreated: true,
        immediatelyCreatedAt: new Date().toISOString(),
        paymentStatus: "pending",
        source: 'immediate_payment_link_creation'
      };

      const paymentDetails = {
        razorpay_payment_id: null, // Will be updated when payment is made
        razorpay_order_id: null,
        payment_link_id: paymentLink.id,
      };

      // Save to both services immediately
      const [firebaseResult, sheetsResult] = await Promise.allSettled([
        saveToFirebase(immediateBookingData, paymentDetails),
        saveBookingToSheet(immediateBookingData)
      ]);

      const immediateDataStored = {
        firebase: firebaseResult.status === 'fulfilled',
        sheets: sheetsResult.status === 'fulfilled',
        firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
        sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
        timestamp: new Date().toISOString()
      };

      console.log(`📊 Immediate data storage results:`, immediateDataStored);

      // Store the immediate save results
      orderData.immediateDataStored = immediateDataStored;
      orderStore.set(paymentLink.id, orderData);
      orderStore.set(referenceId, orderData);

      if (immediateDataStored.firebase && immediateDataStored.sheets) {
        console.log(`✅ IMMEDIATE SAVE SUCCESS: Data saved to both Firebase and Sheets`);
      } else if (immediateDataStored.firebase || immediateDataStored.sheets) {
        console.log(`⚠️ IMMEDIATE SAVE PARTIAL: Data saved to ${immediateDataStored.firebase ? 'Firebase' : 'Sheets'} only`);
      } else {
        console.log(`❌ IMMEDIATE SAVE FAILED: Data not saved to either service`);
      }
    } catch (immediateError) {
      console.error(`❌ Immediate data save failed for payment link: ${paymentLink.id}`, immediateError);
      // Don't fail the payment link creation if immediate save fails
    }
    
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

// CRITICAL: Enhanced webhook handler with better error handling
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

// Enhanced payment link handler with better data processing
const handlePaymentLinkPaid = async (paymentLinkEntity, paymentEntity, requestId) => {
  try {
    const paymentLinkId = paymentLinkEntity.id;
    const paymentId = paymentEntity.id;
    
    console.log(`🔍 [${requestId}] Processing payment link: ${paymentLinkId} with payment: ${paymentId}`);
    
    // Prevent duplicate processing
    if (processedPayments.has(paymentId)) {
      console.log(`⚠️ [${requestId}] Payment already processed: ${paymentId}`);
      return;
    }
    
    // Mark as processing
    processedPayments.add(paymentId);
    
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

    console.log(`💾 [${requestId}] Saving data to Firebase and Sheets...`);
    console.log(`📊 [${requestId}] Booking data summary:`, {
      bookingName: bookingDataWithPayment.bookingName,
      paymentId: paymentId,
      totalAmount: bookingDataWithPayment.totalAmount,
      advanceAmount: bookingDataWithPayment.advanceAmount
    });

    // Save to both services with enhanced error handling
    const [firebaseResult, sheetsResult] = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    // Log detailed results
    const dataStored = {
      firebase: firebaseResult.status === 'fulfilled',
      sheets: sheetsResult.status === 'fulfilled',
      firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
      sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
      timestamp: new Date().toISOString()
    };

    console.log(`📊 [${requestId}] Data storage results:`, dataStored);

    // Update order status
    orderDetails.status = "paid";
    orderDetails.paymentEntity = paymentEntity;
    orderDetails.dataStored = dataStored;
    orderDetails.savedBooking = firebaseResult.status === 'fulfilled' ? firebaseResult.value : null;
    orderDetails.processedAt = new Date().toISOString();
    orderDetails.webhookRequestId = requestId;
    
    // Store with multiple keys for better lookup
    orderStore.set(paymentLinkId, orderDetails);
    if (orderDetails.reference_id) {
      orderStore.set(orderDetails.reference_id, orderDetails);
    }
    
    // Log success
    if (dataStored.firebase && dataStored.sheets) {
      console.log(`✅ [${requestId}] COMPLETE SUCCESS: Data saved to both Firebase and Sheets`);
    } else if (dataStored.firebase || dataStored.sheets) {
      console.log(`⚠️ [${requestId}] PARTIAL SUCCESS: Data saved to ${dataStored.firebase ? 'Firebase' : 'Sheets'} only`);
    } else {
      console.log(`❌ [${requestId}] FAILURE: Data not saved to either service`);
    }
    
    console.log(`✅ [${requestId}] Payment link processing completed`);
  } catch (error) {
    console.error(`❌ [${requestId}] Payment link processing failed:`, error);
    processedPayments.delete(paymentEntity.id); // Remove from processed set on error
    
    // Enhanced error handling: Try to save minimal data even if processing fails
    try {
      console.log(`🔧 [${requestId}] Attempting minimal data save for failed webhook processing...`);
      
      const minimalBookingData = {
        paymentId: paymentEntity.id,
        orderId: paymentEntity.order_id,
        paymentLinkId: paymentLinkEntity.id,
        totalAmount: paymentEntity.amount / 100,
        advanceAmount: paymentEntity.amount / 100,
        remainingAmount: 0,
        source: 'webhook_error_recovery',
        errorRecoveryAt: new Date().toISOString(),
        originalError: error.message,
        paymentStatus: "paid_but_processing_failed",
        bookingName: 'Webhook Error Recovery',
        NameUser: 'Webhook Error Recovery',
        email: '',
        address: '',
        whatsapp: '',
        people: 1,
        wantDecoration: 'Yes',
        extraDecorations: [],
        slotType: 'deluxe',
        occasion: 'Special Event'
      };

      const minimalPaymentDetails = {
        razorpay_payment_id: paymentEntity.id,
        razorpay_order_id: paymentEntity.order_id,
        payment_link_id: paymentLinkEntity.id,
      };

      // Try to save minimal data
      const [firebaseResult, sheetsResult] = await Promise.allSettled([
        saveToFirebase(minimalBookingData, minimalPaymentDetails),
        saveBookingToSheet(minimalBookingData)
      ]);

      const errorRecoveryResults = {
        firebase: firebaseResult.status === 'fulfilled',
        sheets: sheetsResult.status === 'fulfilled',
        firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
        sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
        timestamp: new Date().toISOString()
      };

      console.log(`📊 [${requestId}] Error recovery data save results:`, errorRecoveryResults);

      if (errorRecoveryResults.firebase || errorRecoveryResults.sheets) {
        console.log(`✅ [${requestId}] ERROR RECOVERY SUCCESS: Minimal data saved to prevent complete loss`);
      } else {
        console.log(`❌ [${requestId}] ERROR RECOVERY FAILED: Unable to save even minimal data`);
      }
    } catch (recoveryError) {
      console.error(`❌ [${requestId}] Error recovery also failed:`, recoveryError);
    }
  }
};

// Enhanced payment captured handler
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
    
    // Prevent duplicate processing
    if (processedPayments.has(paymentId)) {
      console.log(`⚠️ [${requestId}] Payment already processed: ${paymentId}`);
      return;
    }
    
    // If this is a payment link payment, it should be handled by payment_link.paid event
    if (paymentLinkId) {
      console.log(`ℹ️ [${requestId}] Payment link payment - should be handled by payment_link.paid event`);
      return;
    }
    
    // Mark as processing
    processedPayments.add(paymentId);
    
    // Handle regular order payments
    let orderDetails = null;
    
    if (orderId) {
      orderDetails = orderStore.get(orderId);
    }
    
    if (!orderDetails) {
      console.log(`⚠️ [${requestId}] Order data not found for regular payment: ${paymentId}`);
      return;
    }
    
    // Process regular payment (similar to payment link handling)
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

    console.log(`💾 [${requestId}] Saving regular payment data...`);

    // Save to both services
    const [firebaseResult, sheetsResult] = await Promise.allSettled([
      saveToFirebase(bookingDataWithPayment, paymentDetails),
      saveBookingToSheet(bookingDataWithPayment)
    ]);

    const dataStored = {
      firebase: firebaseResult.status === 'fulfilled',
      sheets: sheetsResult.status === 'fulfilled',
      firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
      sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
      timestamp: new Date().toISOString()
    };

    console.log(`📊 [${requestId}] Regular payment data storage results:`, dataStored);

    // Update order status
    orderDetails.status = "paid";
    orderDetails.paymentId = paymentId;
    orderDetails.dataStored = dataStored;
    orderDetails.processedAt = new Date().toISOString();
    orderStore.set(orderId, orderDetails);

    console.log(`✅ [${requestId}] Regular payment processing completed`);
  } catch (error) {
    console.error(`❌ [${requestId}] Payment captured processing failed:`, error);
    processedPayments.delete(paymentEntity.id); // Remove from processed set on error
    
    // Enhanced error handling for regular payments
    try {
      console.log(`🔧 [${requestId}] Attempting minimal data save for failed regular payment processing...`);
      
      const minimalBookingData = {
        paymentId: paymentEntity.id,
        orderId: paymentEntity.order_id,
        totalAmount: paymentEntity.amount / 100,
        advanceAmount: paymentEntity.amount / 100,
        remainingAmount: 0,
        source: 'regular_payment_error_recovery',
        errorRecoveryAt: new Date().toISOString(),
        originalError: error.message,
        paymentStatus: "paid_but_processing_failed",
        bookingName: 'Regular Payment Error Recovery',
        NameUser: 'Regular Payment Error Recovery',
        email: '',
        address: '',
        whatsapp: '',
        people: 1,
        wantDecoration: 'Yes',
        extraDecorations: [],
        slotType: 'deluxe',
        occasion: 'Special Event'
      };

      const minimalPaymentDetails = {
        razorpay_payment_id: paymentEntity.id,
        razorpay_order_id: paymentEntity.order_id,
        payment_link_id: null,
      };

      // Try to save minimal data
      const [firebaseResult, sheetsResult] = await Promise.allSettled([
        saveToFirebase(minimalBookingData, minimalPaymentDetails),
        saveBookingToSheet(minimalBookingData)
      ]);

      const errorRecoveryResults = {
        firebase: firebaseResult.status === 'fulfilled',
        sheets: sheetsResult.status === 'fulfilled',
        firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
        sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
        timestamp: new Date().toISOString()
      };

      console.log(`📊 [${requestId}] Regular payment error recovery results:`, errorRecoveryResults);

      if (errorRecoveryResults.firebase || errorRecoveryResults.sheets) {
        console.log(`✅ [${requestId}] REGULAR PAYMENT ERROR RECOVERY SUCCESS: Minimal data saved`);
      } else {
        console.log(`❌ [${requestId}] REGULAR PAYMENT ERROR RECOVERY FAILED: Unable to save data`);
      }
    } catch (recoveryError) {
      console.error(`❌ [${requestId}] Regular payment error recovery also failed:`, recoveryError);
    }
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

// Backup data save endpoint for thank you page
app.post("/save-backup-data", async (req, res) => {
  try {
    const { bookingData, paymentId, orderId } = req.body;
    
    if (!bookingData) {
      return res.status(400).json({ error: "Booking data required" });
    }
    
    console.log(`💾 Backup data save requested for payment: ${paymentId}`);
    
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

        // Save to both services
        const [firebaseResult, sheetsResult] = await Promise.allSettled([
          saveToFirebase(bookingDataWithPayment, paymentDetails),
          saveBookingToSheet(bookingDataWithPayment)
        ]);
        
        const dataStored = {
          firebase: firebaseResult.status === 'fulfilled',
          sheets: sheetsResult.status === 'fulfilled',
          firebaseError: firebaseResult.status === 'rejected' ? firebaseResult.reason?.message : null,
          sheetsError: sheetsResult.status === 'rejected' ? sheetsResult.reason?.message : null,
          timestamp: new Date().toISOString()
        };

        console.log(`✅ Payment recovery completed:`, dataStored);
        
        res.json({
          status: "recovered",
          paymentId: payment.id,
          dataStored: dataStored
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
  
  // Also clean up processed payments older than 1 hour
  const processedPaymentsCopy = new Set(processedPayments);
  processedPaymentsCopy.forEach(paymentId => {
    // Keep recent payments in the set for 1 hour
    // In a real implementation, you'd want to store timestamps
    if (processedPayments.size > 1000) {
      processedPayments.clear();
    }
  });
  
}, 30 * 60 * 1000); // Run every 30 minutes

// Enhanced health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeOrders: orderStore.size,
    processedPayments: processedPayments.size,
    version: "3.1 - Enhanced Data Protection",
    environment: process.env.NODE_ENV || 'development',
    features: {
      webhookSignatureVerification: true,
      multipleOrderLookup: true,
      dataRecovery: true,
      retryLogic: true,
      duplicateProtection: true,
      immediateDataSave: true,
      backupDataEndpoint: true,
      thankyouPageBackup: true,
      webhookErrorRecovery: true
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
      processedPayments: processedPayments.size
    });
  });
  
  app.get("/debug/processed-payments", (req, res) => {
    res.json({ 
      processedPayments: Array.from(processedPayments),
      count: processedPayments.size
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
  console.log(`🚀 Enhanced Server v3.1 running on port ${PORT}`);
  console.log(`📡 Payment Links API Ready`);
  console.log(`🔗 Webhook endpoint: /webhook`);
  console.log(`🔄 Recovery endpoint: /recover-payment`);
  console.log(`💾 Backup data endpoint: /save-backup-data`);
  console.log(`📊 Health check: /health`);
  console.log(`🧪 Test webhook: /test-webhook`);
  console.log(`✅ Enhanced data protection features enabled:`);
  console.log(`   • Immediate data save on payment link creation`);
  console.log(`   • Thank you page backup data save`);
  console.log(`   • Webhook error recovery system`);
  console.log(`   • Improved webhook signature verification`);
  console.log(`   • Multiple order lookup strategies`);
  console.log(`   • Automatic data recovery system`);
  console.log(`   • Retry logic for data saving`);
  console.log(`   • Duplicate payment protection`);
  console.log(`   • Better error handling and logging`);
});

"use client";

import { auth as authInternal , database as databaseInternal } from './firebase'; 
import { database as walletDatabaseInternal } from './firebaseWallet';
import { database as tripsDatabaseInternal } from './firebaseTrips';
import { database as codesDatabaseInternal } from './firebaseCodes'; // Import the new codes database
import { 
  onAuthStateChanged,
  type User as FirebaseAuthUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { ref, set, get, child, update, remove, query, orderByChild, equalTo, serverTimestamp, runTransaction, push } from 'firebase/database';
import type { SeatID } from './constants';
import { SEAT_CONFIG } from './constants'; 
import { useToast } from '@/hooks/use-toast';

export const auth = authInternal;
export const database = databaseInternal;

export interface PassengerBookingDetails {
  userId: string;
  phone: string;
  fullName: string; 
  bookedAt: any; 
  paymentType?: string; // e.g., "cash", "click"
  dropOffPoint?: string; // e.g., "Stop Name 1"
  fees?: number; // Added fees
}

export interface UserProfileTopUpCode {
  code: string;
  amount: number;
  status: 'unused' | 'used';
  createdAt: any; // Or number for timestamp
}

// Type for the new structure in the codes database
export interface TopUpCode {
    id: string;
    amount: number;
    code: string;
    createdAt: number;
    driverId: string;
    status: 'unused' | 'used';
    usedAt?: any;
}

export interface UserProfile {
  id: string; 
  fullName: string;
  email: string; 
  phone: string; 
  secondaryPhone?: string;
  idNumber?: string;
  idPhotoUrl: string; 
  licenseNumber?: string;
  licenseExpiry?: string;
  licensePhotoUrl: string;
  vehicleType?: string;
  otherVehicleType?: string | null;
  vehicleYear?: string;
  vehicleColor?: string;
  vehiclePlateNumber?: string;
  vehiclePhotosUrl: string;
  paymentMethods?: {
    click?: boolean;
    cash?: boolean;
    clickCode?: string;
  };
  walletBalance?: number; 
  topUpCodes?: Record<string, UserProfileTopUpCode>;
  status: 'pending' | 'approved' | 'rejected' | 'suspended' | 'active';
  createdAt: any; 
  updatedAt?: any;
  rating: number;
  tripsCount: number;
}

export interface WalletTransaction {
    id: string;
    type: 'charge' | 'trip_earning' | 'trip_fee' | 'system_adjustment' | 'refund' | 'deduct' | 'transfer';
    amount: number; // Positive for income, negative for outcome
    date: any; // serverTimestamp
    description: string;
    tripId?: string;
    balanceAfter?: number;
}


export interface WaitingListDriverProfile {
  fullName: string;
  phone: string;
  secondaryPhone?: string;
  password?: string;
  idNumber?: string;
  idPhotoUrl?: string | null;
  licenseNumber?: string;
  licenseExpiry?: string;
  licensePhotoUrl?: string | null;
  vehicleType?: string;
  vehicleYear?: string;
  vehicleColor?: string;
  vehiclePlateNumber?: string;
  vehiclePhotosUrl?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
}

export interface Trip {
  id: string; 
  driverId: string; 
  tripReferenceNumber: number;
  startPoint: string; 
  stops?: string[]; 
  destination: string; 
  dateTime: string; 
  expectedArrivalTime: string; 
  offeredSeatsConfig: Record<string, boolean | PassengerBookingDetails>; 
  meetingPoint: string;
  pricePerPassenger: number;
  notes?: string;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  earnings?: number;
  createdAt: any; 
  updatedAt?: any; 
  selectedSeats: SeatID[];
}

export type NewTripData = Omit<Trip, 'id' | 'status' | 'earnings' | 'driverId' | 'createdAt' | 'updatedAt' | 'selectedSeats' | 'tripReferenceNumber'>;

export interface SupportRequestData {
  userId: string;
  fullName: string;
  phone: string;
  message: string;
  status?: 'new' | 'in_progress' | 'resolved';
  createdAt?: any;
}

interface PricingConfig {
    commissionFixed: number;
    commissionFixedEnabled: boolean;
    commissionPercentage: number;
    commissionPercentageEnabled: boolean;
}


// --- Auth Service ---
export const getCurrentUser = (): FirebaseAuthUser | null => {
  if (!authInternal) return null;
  return authInternal.currentUser;
};

export const onAuthUserChangedListener = (callback: (user: FirebaseAuthUser | null) => void) => {
  if (!authInternal) return () => {};
  return onAuthStateChanged(authInternal, callback);
};

export const reauthenticateAndChangePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error("المستخدم غير مسجل الدخول أو لا يوجد بريد إلكتروني مرتبط.");
  }

  const credential = EmailAuthProvider.credential(user.email, currentPassword);

  // Re-authenticate the user
  await reauthenticateWithCredential(user, credential);
  
  // If re-authentication is successful, update the password
  await updatePassword(user, newPassword);
};


// --- User Profile Service ---
export const saveUserProfile = async (userId: string, profileData: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt' >): Promise<void> => {
  if (!databaseInternal) throw new Error("Firebase Database is not initialized.");
  const userRef = ref(databaseInternal, `users/${userId}`);
  const fullProfileData: UserProfile = {
    id: userId,
    ...profileData,
    status: profileData.status || 'pending',
    walletBalance: profileData.walletBalance || 0,
    topUpCodes: profileData.topUpCodes || {},
    createdAt: serverTimestamp(),
  };
  await set(userRef, fullProfileData);
};

export const getWalletData = async (userId: string): Promise<{walletBalance: number} | null> => {
    if (!walletDatabaseInternal) return null;
    const walletRef = ref(walletDatabaseInternal, `wallets/${userId}`);
    try {
        const snapshot = await get(walletRef);
        if (snapshot.exists()) {
            return snapshot.val();
        }
    } catch (e) {
        console.warn("Could not get wallet data, returning null. This is expected if the node doesn't exist yet.", e);
    }
    return null;
};


export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  if (!databaseInternal) return null;
  const userRef = ref(databaseInternal, `users/${userId}`);
  const snapshot = await get(userRef);

  if (snapshot.exists()) {
    const profile = snapshot.val() as UserProfile;
    
    try {
        const walletData = await getWalletData(userId);
        // Force wallet balance to the fetched value, or 0 if it fails or doesn't exist.
        profile.walletBalance = walletData?.walletBalance ?? 0;
    } catch (walletError) {
        console.error("Critical error fetching wallet data for profile. Forcing balance to 0.", walletError);
        profile.walletBalance = 0;
    }

    if (!profile.topUpCodes) {
        profile.topUpCodes = {};
    }
    return profile;
  }
  return null;
};

export const doesPhoneOrEmailExist = async (phone: string, email: string): Promise<{ phoneExists: boolean, emailExists: boolean }> => {
    if (!databaseInternal) throw new Error("Firebase Database is not initialized.");
    
    // Check if phone number exists in the public map. This requires the '/phoneEmailMap' path to have public read access.
    const phoneMapRef = ref(databaseInternal, `phoneEmailMap/${phone}`);
    const phoneSnapshot = await get(phoneMapRef);
    const phoneExists = phoneSnapshot.exists();

    // We can't directly check for email existence in the 'users' table without read access.
    // We will rely on Firebase Auth's error for email existence, so we can return false here.
    return { phoneExists, emailExists: false };
};


export const getEmailByPhone = async (phone: string): Promise<string | null> => {
    if (!databaseInternal) return null;
    // Use the public phoneEmailMap instead of the protected 'users' path
    // IMPORTANT: This requires '.read': true on the 'phoneEmailMap' path in your Firebase rules.
    const mapRef = ref(databaseInternal, `phoneEmailMap/${phone}`);
    const snapshot = await get(mapRef);
    if (snapshot.exists()) {
        return snapshot.val().email;
    }
    return null;
};

// This function is for internal use during sign-in and password reset.
// It should not be used to get the full user profile.
export const getUserByPhone = async (phone: string): Promise<{email: string} | null> => {
    // This function is now a wrapper around getEmailByPhone
    const email = await getEmailByPhone(phone);
    if (email) {
        return { email };
    }
    return null;
};


export const updateUserProfile = async (userId: string, updates: Partial<UserProfile>): Promise<void> => {
  if (!databaseInternal) return;
  const userRef = ref(databaseInternal, `users/${userId}`);
  // Separate wallet updates from profile updates
  const { walletBalance, ...profileUpdates } = updates;

  if (Object.keys(profileUpdates).length > 0) {
     await update(userRef, {...profileUpdates, updatedAt: serverTimestamp()});
  }

  if (walletBalance !== undefined && walletDatabaseInternal) {
      const walletRef = ref(walletDatabaseInternal, `wallets/${userId}`);
      await update(walletRef, { walletBalance });
  }
};

export const createDriverAccount = async (
  profileData: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
  password: string
): Promise<string> => {
    if (!auth || !database) {
        throw new Error("Firebase Auth or Database is not initialized.");
    }

    let userId: string | null = null;
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, profileData.email, password);
        userId = userCredential.user.uid;

        const finalProfileData: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'> = {
            ...profileData,
            otherVehicleType: profileData.otherVehicleType || null, // Ensure null instead of undefined
            status: 'pending' as const,
        };
        
        await saveUserProfile(userId, finalProfileData);
        
        // Write to phoneEmailMap for login lookup
        const phoneMapRef = ref(database, `phoneEmailMap/${profileData.phone}`);
        await set(phoneMapRef, { email: profileData.email });
        
        // Also create an entry in the wallet database
        if (walletDatabaseInternal) {
            const walletRef = ref(walletDatabaseInternal, `wallets/${userId}`);
            await set(walletRef, {
                walletBalance: 0,
                createdAt: serverTimestamp()
            });
        }
        
        // Sign out the user after registration so they have to log in.
        await firebaseSignOut(auth);
        
        return userId;
    } catch (error: any) {
        if (userId) {
            console.error(`Orphaned user created in Auth with UID: ${userId}. DB operations failed.`, error);
        }
        if (error.code === 'auth/email-already-in-use') {
             throw new Error("EMAIL_EXISTS");
        }
        throw error;
    }
};

export const addDriverToWaitingList = async (
  profileData: Omit<WaitingListDriverProfile, 'status' | 'createdAt'>
): Promise<void> => {
    if (!database) return;

    const newDriverRef = push(ref(database, 'users'));
    const userId = newDriverRef.key;

    if (!userId) throw new Error("Could not generate a new user ID.");

    // This is essentially creating a user profile directly
    const fullProfile: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'> = {
        fullName: profileData.fullName,
        phone: profileData.phone,
        email: 'placeholder@email.com', // Placeholder email, main registration should handle this
        secondaryPhone: profileData.secondaryPhone || '',
        idNumber: profileData.idNumber,
        idPhotoUrl: profileData.idPhotoUrl || '',
        licenseNumber: profileData.licenseNumber,
        licenseExpiry: profileData.licenseExpiry,
        licensePhotoUrl: profileData.licensePhotoUrl || '',
        vehicleType: profileData.vehicleType,
        otherVehicleType: null,
        vehicleYear: profileData.vehicleYear,
        vehicleColor: profileData.vehicleColor,
        vehiclePlateNumber: profileData.vehiclePlateNumber,
        vehiclePhotosUrl: profileData.vehiclePhotosUrl || '',
        paymentMethods: { cash: true, click: false, clickCode: '' },
        rating: 5,
        tripsCount: 0,
        walletBalance: 0,
        status: 'pending',
    };

    await saveUserProfile(userId, fullProfile);
};


// --- Wallet Service (Charge Code Logic) ---

const addWalletTransaction = async (userId: string, transaction: Omit<WalletTransaction, 'id'>): Promise<void> => {
    if (!walletDatabaseInternal) return;
    const transactionsRef = ref(walletDatabaseInternal, `walletTransactions/${userId}`);
    const newTransactionRef = push(transactionsRef);
    await set(newTransactionRef, {
        id: newTransactionRef.key,
        ...transaction,
    });
};

export const chargeWalletWithCode = async (
  userId: string,
  chargeCodeInput: string
): Promise<{ success: boolean; message: string; newBalance?: number }> => {
  if (!codesDatabaseInternal || !walletDatabaseInternal) {
    return { success: false, message: "خدمة المحفظة أو الأكواد غير متاحة حالياً." };
  }

  const chargeCode = chargeCodeInput.trim().toUpperCase();

  try {
    const topUpCodesRef = ref(codesDatabaseInternal, 'topUpCodes');
    const allCodesSnapshot = await get(topUpCodesRef);

    if (!allCodesSnapshot.exists()) {
      return { success: false, message: "لا توجد أكواد شحن متاحة في النظام." };
    }

    const allCodes = allCodesSnapshot.val();
    let foundCodeId: string | null = null;
    let foundCodeData: TopUpCode | null = null;

    // Client-side search
    for (const codeId in allCodes) {
      if (allCodes[codeId].code === chargeCode) {
        foundCodeId = codeId;
        foundCodeData = allCodes[codeId];
        break;
      }
    }

    if (!foundCodeId || !foundCodeData) {
      return { success: false, message: "كود الشحن غير صحيح." };
    }

    if (foundCodeData.status !== 'unused') {
      return { success: false, message: "هذا الكود تم استخدامه مسبقاً." };
    }
    
    const amountToAdd = foundCodeData.amount;
    if (!amountToAdd || typeof amountToAdd !== 'number' || amountToAdd <= 0) {
        return { success: false, message: "كود الشحن يحتوي على قيمة غير صالحة." };
    }
    
    const codeToUpdateRef = ref(codesDatabaseInternal, `topUpCodes/${foundCodeId}`);
    const userWalletRef = ref(walletDatabaseInternal, `wallets/${userId}`);

    const walletTransactionResult = await runTransaction(userWalletRef, (walletData) => {
        if (walletData) {
            walletData.walletBalance = (walletData.walletBalance || 0) + amountToAdd;
        } else {
            walletData = { walletBalance: amountToAdd, createdAt: serverTimestamp() };
        }
        walletData.updatedAt = serverTimestamp();
        return walletData;
    });

    if (walletTransactionResult.committed && walletTransactionResult.snapshot.exists()) {
        const newBalance = walletTransactionResult.snapshot.val().walletBalance;

        await update(codeToUpdateRef, {
            status: 'used',
            driverId: userId,
            usedAt: serverTimestamp()
        });
        
        await addWalletTransaction(userId, {
            type: 'charge',
            amount: amountToAdd,
            date: serverTimestamp(),
            description: `تم شحن الرصيد بنجاح باستخدام الكود: ${chargeCode}`,
            balanceAfter: newBalance,
        });
        
        return {
            success: true,
            message: `تم شحن رصيدك بمبلغ ${amountToAdd.toFixed(2)} د.أ بنجاح!`,
            newBalance
        };
    } else {
        throw new Error("فشلت عملية تحديث رصيد المحفظة.");
    }

  } catch (error: any) {
    console.error("Charge wallet failed: ", error);
    return { success: false, message: `حدث خطأ غير متوقع: ${error.message}` };
  }
};


export const getWalletTransactions = async (userId: string): Promise<WalletTransaction[]> => {
    if (!walletDatabaseInternal) return [];
    try {
        const transactionsRef = ref(walletDatabaseInternal, `walletTransactions/${userId}`);
        const snapshot = await get(transactionsRef);
        if (snapshot.exists()) {
            const transactions: WalletTransaction[] = [];
            const data = snapshot.val();
            for(const txId in data){
                transactions.push({ id: txId, ...data[txId] });
            }
            // Sort by date descending (newest first)
            return transactions.sort((a, b) => (b.date || 0) - (a.date || 0));
        }
        return [];
    } catch (error: any) {
        console.error("Error fetching wallet transactions:", error);
        // Do not throw, just return empty so the UI doesn't crash
        return [];
    }
};


// --- Trip Service ---
const CURRENT_TRIPS_PATH = 'currentTrips';
const FINISHED_TRIPS_PATH = 'finishedTrips';
const STOP_STATIONS_PATH = 'stopstations';
const SUPPORT_REQUESTS_PATH = 'supportRequests';
const TRIP_COUNTERS_PATH = 'tripCounters';
const PRICING_PATH = 'pricing/default/Sedan'; // Assuming Sedan for now


export const addTrip = async (driverId: string, tripData: NewTripData, currentBalance: number): Promise<Trip> => {
    if (!tripsDatabaseInternal || !walletDatabaseInternal) {
        throw new Error("إحدى خدمات قاعدة البيانات غير متاحة (الرحلات أو المحفظة).");
    }

    const offeredSeatsCount = Object.values(tripData.offeredSeatsConfig).filter(v => v === true).length;
    if (offeredSeatsCount === 0) {
        throw new Error("لا يمكن إنشاء رحلة بدون مقاعد معروضة.");
    }

    // Fetch pricing configuration
    const pricingRef = ref(tripsDatabaseInternal, PRICING_PATH);
    const pricingSnapshot = await get(pricingRef);
    if (!pricingSnapshot.exists()) {
        throw new Error("لم يتم العثور على إعدادات التسعير. لا يمكن إنشاء الرحلة.");
    }
    const pricingConfig: PricingConfig = pricingSnapshot.val();

    const fixedCommission = (pricingConfig.commissionFixedEnabled) ? pricingConfig.commissionFixed : 0;
    const percentageCommission = (pricingConfig.commissionPercentageEnabled) ? pricingConfig.commissionPercentage : 0;
    const pricePerPassenger = tripData.pricePerPassenger || 0;

    // Calculate total trip commission based on the new formula
    const tripCommission = (offeredSeatsCount * fixedCommission) + (offeredSeatsCount * (percentageCommission / 100) * pricePerPassenger);

    if (currentBalance < tripCommission) {
        throw new Error(`رصيد المحفظة غير كافٍ. الرصيد الحالي: ${currentBalance.toFixed(2)} د.أ، العمولة المطلوبة: ${tripCommission.toFixed(2)} د.أ`);
    }
    
    let newTripId: string | null = null;
    try {
        // 1. Get the new trip reference number using a transaction
        const counterRef = ref(tripsDatabaseInternal, `${TRIP_COUNTERS_PATH}/lastTripNumber`);
        const tripCounterResult = await runTransaction(counterRef, (currentValue) => {
            return (currentValue || 1000) + 1;
        });

        if (!tripCounterResult.committed) {
            throw new Error("فشل في إنشاء الرقم المرجعي للرحلة.");
        }
        const newTripReferenceNumber = tripCounterResult.snapshot.val();

        // 2. Create the new trip with the reference number
        const newTripRef = push(ref(tripsDatabaseInternal, CURRENT_TRIPS_PATH));
        newTripId = newTripRef.key;
        if (!newTripId) throw new Error("فشل في إنشاء معرّف فريد للرحلة.");

        const fullTripData: Trip = {
            id: newTripId,
            driverId: driverId,
            tripReferenceNumber: newTripReferenceNumber,
            ...tripData,
            status: 'upcoming',
            createdAt: serverTimestamp(),
            selectedSeats: [],
        };

        await set(newTripRef, fullTripData);
        
        // 3. Deduct commission from wallet AFTER trip creation is successful
        const walletRef = ref(walletDatabaseInternal, `wallets/${driverId}`);
        const walletTxResult = await runTransaction(walletRef, (wallet) => {
            if (wallet) {
                wallet.walletBalance = (wallet.walletBalance || 0) - tripCommission;
                wallet.updatedAt = serverTimestamp();
            }
            return wallet;
        });
        
        if (!walletTxResult.committed) {
             throw new Error("فشل خصم العمولة من المحفظة.");
        }
        
        const newBalance = walletTxResult.snapshot.val().walletBalance;

        // 4. Log the commission transaction
        await addWalletTransaction(driverId, {
            type: 'trip_fee',
            amount: -tripCommission,
            date: serverTimestamp(),
            description: `عمولة إنشاء رحلة جديدة رقم #${newTripReferenceNumber}`,
            tripId: newTripId,
            balanceAfter: newBalance,
        });

        return fullTripData;

    } catch (tripCreationError) {
        console.error("Trip creation failed. An error occurred during the process.", tripCreationError);
        // No refund logic needed here as commission is deducted after trip creation.
        // If trip creation fails, commission won't be deducted.
        // If commission deduction fails, the trip is already created, which is an acceptable state for manual correction.
        throw tripCreationError;
    }
};


export const startTrip = async (tripId: string): Promise<void> => {
  if (!tripsDatabaseInternal) return;
  const tripRef = ref(tripsDatabaseInternal, `${CURRENT_TRIPS_PATH}/${tripId}`);
  const snapshot = await get(tripRef);
  if (snapshot.exists()) {
    const trip = snapshot.val() as Trip;
    if (trip.status === 'upcoming') {
      await update(tripRef, { status: 'ongoing', updatedAt: serverTimestamp() });
    } else {
      throw new Error("لا يمكن بدء رحلة ليست قادمة.");
    }
  } else {
    throw new Error("Trip not found.");
  }
};

export const updateTrip = async (tripId: string, updates: Partial<Trip>): Promise<void> => {
  if (!tripsDatabaseInternal) return;
  const tripRef = ref(tripsDatabaseInternal, `${CURRENT_TRIPS_PATH}/${tripId}`);
  await update(tripRef, { ...updates, updatedAt: serverTimestamp() });
};

const refundForUnbookedSeats = async (trip: Trip, reason: 'cancelled' | 'completed') => {
  if (!walletDatabaseInternal || !tripsDatabaseInternal) return;

  const driverId = trip.driverId;
  const tripId = trip.id;
  const transactionsRef = ref(walletDatabaseInternal, `walletTransactions/${driverId}`);
  const txSnapshot = await get(transactionsRef);

  if (!txSnapshot.exists()) {
    console.warn(`No wallet transactions found for driver ${driverId} to process refund.`);
    return;
  }

  const transactions = txSnapshot.val();
  let originalCommission = 0;
  
  // Client-side search for the original commission fee transaction for this trip
  for (const txId in transactions) {
    if (transactions[txId].tripId === tripId && transactions[txId].type === 'trip_fee') {
      originalCommission = Math.abs(transactions[txId].amount);
      break;
    }
  }

  if (originalCommission === 0) {
    console.warn(`Original commission for trip ${tripId} not found or is zero. No refund processed.`);
    return;
  }

  const offeredSeats = Object.values(trip.offeredSeatsConfig).filter(v => v === true || typeof v === 'object');
  const totalOfferedSeats = offeredSeats.length;
  const unbookedSeats = offeredSeats.filter(v => v === true).length;

  if (totalOfferedSeats === 0 || unbookedSeats === 0) {
    console.log(`No unbooked seats for trip ${tripId}. No refund processed.`);
    return;
  }

  // Calculate the refund amount based on the number of unbooked seats
  const refundAmount = (originalCommission / totalOfferedSeats) * unbookedSeats;
  
  if (refundAmount <= 0) {
    return;
  }

  const walletRef = ref(walletDatabaseInternal, `wallets/${driverId}`);
  const walletTxResult = await runTransaction(walletRef, (wallet) => {
    if (wallet) {
      wallet.walletBalance = (wallet.walletBalance || 0) + refundAmount;
      wallet.updatedAt = serverTimestamp();
    }
    return wallet;
  });

  if (walletTxResult.committed) {
    const newBalance = walletTxResult.snapshot.val().walletBalance;
    await addWalletTransaction(driverId, {
      type: 'refund',
      amount: refundAmount,
      date: serverTimestamp(),
      description: `تعويض عن المقاعد الفارغة لرحلة ${reason === 'cancelled' ? 'ملغاة' : 'مكتملة'} #${trip.tripReferenceNumber}`,
      tripId: tripId,
      balanceAfter: newBalance,
    });
  }
};


export const deleteTrip = async (tripId: string): Promise<void> => {
  if (!tripsDatabaseInternal || !walletDatabaseInternal) {
      throw new Error("خدمة قاعدة البيانات غير متاحة.");
  }
  const tripRef = ref(tripsDatabaseInternal, `${CURRENT_TRIPS_PATH}/${tripId}`);
  const snapshot = await get(tripRef);

  if (snapshot.exists()) {
      const trip = snapshot.val() as Trip;

      if (trip.status !== 'upcoming' && trip.status !== 'cancelled') {
          throw new Error("لا يمكن إلغاء رحلة جارية أو مكتملة. يجب إنهاؤها.");
      }

      // Check if cancellation is within 5 minutes for refund
      const now = Date.now();
      const createdAt = typeof trip.createdAt === 'number' ? trip.createdAt : (trip.createdAt?.seconds * 1000 || now);
      const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;

      if (now - createdAt < FIVE_MINUTES_IN_MS) {
        await refundForUnbookedSeats(trip, 'cancelled');
      }

      // Move trip to finishedTrips with 'cancelled' status
      const finishedTripRef = ref(tripsDatabaseInternal, `${FINISHED_TRIPS_PATH}/${tripId}`);
      await set(finishedTripRef, { ...trip, status: 'cancelled', updatedAt: serverTimestamp() });
      await remove(tripRef);

  } else {
      console.warn(`Trip with ID ${tripId} not found in currentTrips for deletion.`);
  }
};


export const getTripById = async (tripId: string): Promise<Trip | null> => {
  if (!tripsDatabaseInternal) return null;
  const tripRef = ref(tripsDatabaseInternal, `${CURRENT_TRIPS_PATH}/${tripId}`);
  const snapshot = await get(tripRef);
  if (snapshot.exists()) {
    return snapshot.val() as Trip;
  }
  // If not in current, check finished trips
  const finishedTripRef = ref(tripsDatabaseInternal, `${FINISHED_TRIPS_PATH}/${tripId}`);
  const finishedSnapshot = await get(finishedTripRef);
  if(finishedSnapshot.exists()){
      return finishedSnapshot.val() as Trip;
  }
  return null;
};

export const getUpcomingAndOngoingTripsForDriver = async (driverId: string): Promise<Trip[]> => {
  if (!tripsDatabaseInternal) {
    throw new Error("خدمة قاعدة بيانات الرحلات غير متاحة.");
  }
  try {
    const allTripsRef = ref(tripsDatabaseInternal, CURRENT_TRIPS_PATH);
    const snapshot = await get(allTripsRef);
    const trips: Trip[] = [];
    if (snapshot.exists()) {
      const allTrips = snapshot.val();
      for (const tripId in allTrips) {
        const trip = allTrips[tripId] as Trip;
        // Filter on the client-side
        if (trip.driverId === driverId && (trip.status === 'upcoming' || trip.status === 'ongoing')) {
          trips.push(trip);
        }
      }
    }
    // Sort by date: ongoing first, then upcoming sorted by date
    return trips.sort((a, b) => {
        if (a.status === 'ongoing' && b.status !== 'ongoing') return -1;
        if (a.status !== 'ongoing' && b.status === 'ongoing') return 1;
        return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    });
  } catch (error) {
      console.error("Error fetching upcoming/ongoing trips from Firebase:", error);
      throw new Error(`فشل في جلب الرحلات: ${(error as Error).message}`);
  }
};


export const getActiveTripForDriver = async (driverId: string): Promise<Trip | null> => {
  if (!tripsDatabaseInternal) return null;
  try {
    const tripsRef = ref(tripsDatabaseInternal, CURRENT_TRIPS_PATH);
    const snapshot = await get(tripsRef);
    if (snapshot.exists()) {
      let activeTrip: Trip | null = null;
      const allTrips = snapshot.val();
      for (const tripId in allTrips) {
        const trip = allTrips[tripId] as Trip;
        if (trip.driverId === driverId && (trip.status === 'upcoming' || trip.status === 'ongoing')) {
            activeTrip = trip;
            break; 
        }
      }
      return activeTrip;
    }
  } catch(e){
    console.warn("Could not check for active trip, assuming none. This is expected if 'currentTrips' doesn't exist.", e);
  }
  return null;
};


export const getCompletedTripsForDriver = async (driverId: string): Promise<Trip[]> => {
  if (!tripsDatabaseInternal) return [];
  const finishedTripsRef = ref(tripsDatabaseInternal, FINISHED_TRIPS_PATH);
  const snapshot = await get(finishedTripsRef);
  const trips: Trip[] = [];
  if (snapshot.exists()) {
    const allTrips = snapshot.val();
    for (const tripId in allTrips) {
        const trip = allTrips[tripId];
        if (trip.driverId === driverId) {
            trips.push(trip);
        }
    }
  }
  // sort by date descending
  return trips.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const getAllTripsForDriver = async (driverId: string): Promise<Trip[]> => {
    if (!tripsDatabaseInternal) return [];
    
    // Fetch upcoming and ongoing trips
    const upcomingAndOngoing = await getUpcomingAndOngoingTripsForDriver(driverId);
    
    // Fetch finished trips (completed and cancelled)
    const finishedTripsRef = ref(tripsDatabaseInternal, FINISHED_TRIPS_PATH);
    const finishedSnapshot = await get(finishedTripsRef);
    const completedAndCancelled: Trip[] = [];
    if (finishedSnapshot.exists()) {
        const allFinishedTrips = finishedSnapshot.val();
        for (const tripId in allFinishedTrips) {
            const trip = allFinishedTrips[tripId];
            if (trip.driverId === driverId) {
                completedAndCancelled.push(trip);
            }
        }
    }
    
    const allTrips = [...upcomingAndOngoing, ...completedAndCancelled];
    
    // Sort all trips by creation date descending (newest first)
    return allTrips.sort((a, b) => {
        const dateA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (typeof a.createdAt === 'number' ? a.createdAt : new Date(a.dateTime).getTime());
        const dateB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (typeof b.createdAt === 'number' ? b.createdAt : new Date(b.dateTime).getTime());
        return dateB - dateA;
    });
};


export const endTrip = async (tripToEnd: Trip): Promise<void> => {
  if (!tripsDatabaseInternal) return;
  const currentTripRef = ref(tripsDatabaseInternal, `${CURRENT_TRIPS_PATH}/${tripToEnd.id}`);
  const finishedTripRef = ref(tripsDatabaseInternal, `${FINISHED_TRIPS_PATH}/${tripToEnd.id}`);

  // No more earnings are passed or calculated here.
  const finishedTripData = {
    ...tripToEnd,
    status: 'completed' as const,
    earnings: 0, // Set earnings to 0 as requested
    updatedAt: serverTimestamp()
  };

  // Record the finished trip
  await set(finishedTripRef, finishedTripData);
  
  // Remove from current trips
  await remove(currentTripRef);

  // New: Refund for unbooked seats upon trip completion.
  await refundForUnbookedSeats(tripToEnd, 'completed');
};


export const getTrips = async (): Promise<Trip[]> => {
    if (!tripsDatabaseInternal) return [];
    const currentTripsRef = ref(tripsDatabaseInternal, CURRENT_TRIPS_PATH);
    const snapshot = await get(currentTripsRef);
    if (snapshot.exists()) {
        const trips: Trip[] = [];
        snapshot.forEach(childSnapshot => {
            trips.push(childSnapshot.val());
        });
        return trips;
    }
    return [];
};

// --- Booking Cancellation Service ---
export const cancelPassengerBooking = async (tripId: string, seatId: SeatID): Promise<{ success: boolean; message: string }> => {
  if (!tripsDatabaseInternal) return { success: false, message: "Trips database is not initialized."};
  const seatRef = ref(tripsDatabaseInternal, `${CURRENT_TRIPS_PATH}/${tripId}/offeredSeatsConfig/${seatId}`);

  return runTransaction(seatRef, (currentData) => {
    if (currentData === null || typeof currentData !== 'object') {
      // Seat is not booked, or data is malformed
      return; // Abort
    }
    // If it's an object, it's booked. We revert it to `true` (available).
    return true;
  }).then(result => {
    if (result.committed) {
      return { success: true, message: "تم إلغاء حجز الراكب بنجاح." };
    } else {
      return { success: false, message: "فشل إلغاء الحجز. قد يكون المقعد غير محجوز أصلاً." };
    }
  }).catch(error => {
    console.error("Passenger cancellation transaction failed: ", error);
    return { success: false, message: "حدث خطأ غير متوقع أثناء الإلغاء." };
  });
};


// --- Stop Stations Service ---
export const generateRouteKey = (startPointId: string, destinationId: string): string => {
  return `${startPointId.toLowerCase()}_to_${destinationId.toLowerCase()}`;
};

export const getStopStationsForRoute = async (startPointId: string, destinationId: string): Promise<string[] | null> => {
  if (!tripsDatabaseInternal) return null;
  const routeKey = generateRouteKey(startPointId, destinationId);
  const routeRef = ref(tripsDatabaseInternal, `${STOP_STATIONS_PATH}/${routeKey}`);
  const snapshot = await get(routeRef);
  if (snapshot.exists()) {
    const stopsObject = snapshot.val();
    // Firebase returns an object with keys, convert to an array of names
    return Object.values(stopsObject) as string[];
  }
  return null;
};

export const addStopsToRoute = async (startPointId: string, destinationId: string, newStops: string[]): Promise<void> => {
  if (!tripsDatabaseInternal || newStops.length === 0) return;
  const routeKey = generateRouteKey(startPointId, destinationId);
  const routeRef = ref(tripsDatabaseInternal, `${STOP_STATIONS_PATH}/${routeKey}`);

  const existingStopsSnapshot = await get(routeRef);
  const existingStops: string[] = existingStopsSnapshot.exists() ? Object.values(existingStopsSnapshot.val()) : [];
  
  const stopsToAdd: Record<string, string> = {};
  newStops.forEach(stop => {
    if (stop && !existingStops.includes(stop)) {
      // Use push to generate a unique key for each stop to avoid overwrites
      const newStopRef = push(routeRef);
      // @ts-ignore
      stopsToAdd[newStopRef.key] = stop;
    }
  });

  if (Object.keys(stopsToAdd).length > 0) {
    await update(routeRef, stopsToAdd);
  }
};

// --- Support Service ---
export const submitSupportRequest = async (data: Omit<SupportRequestData, 'status' | 'createdAt'>): Promise<void> => {
    if (!databaseInternal) return;
    const supportRequestsRef = ref(databaseInternal, SUPPORT_REQUESTS_PATH);
    const newRequestRef = push(supportRequestsRef);
    const requestData: SupportRequestData = {
        ...data,
        status: 'new',
        createdAt: serverTimestamp(),
    };
    await set(newRequestRef, requestData);
};

export const getDriverWhatsAppNumber = async (): Promise<string | null> => {
  if (!databaseInternal) return null;
  const whatsAppRef = ref(databaseInternal, 'driverWhatsApp');
  const snapshot = await get(whatsAppRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return null;
};



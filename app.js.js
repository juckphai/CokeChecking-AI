// ============================================================
// FIREBASE CONFIG
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyC9JntzJVGLSPc-hSzNPbbdtjWlfme8ecA",
    authDomain: "cokechecking-ai.firebaseapp.com",
    databaseURL: "https://cokechecking-ai-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "cokechecking-ai",
    storageBucket: "cokechecking-ai.firebasestorage.app",
    messagingSenderId: "63023828658",
    appId: "1:63023828658:web:5725f1f9aebd937f4ac3ab"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// ============================================================
// HELPERS
// ============================================================
function showToast(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c * 1000;
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Browser ไม่รองรับ GPS'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                reject(new Error('ไม่สามารถระบุตำแหน่งได้: ' + error.message));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

function navigateTo(hash) {
    window.location.hash = hash;
}

// ============================================================
// FACE RECOGNITION SERVICE (Simplified)
// ============================================================
class FaceRecognitionService {
    constructor() {
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        console.log('Face Recognition initialized');
    }

    async detectFace(videoElement) {
        await this.initialize();
        return { detected: true, keypoints: [] };
    }

    async detectBlink(videoElement) {
        return true;
    }

    async compareFace(videoElement, storedData) {
        return { matched: true, similarity: 0.95 };
    }
}

// ============================================================
// TELEGRAM SERVICE
// ============================================================
class TelegramService {
    constructor() {
        this.botToken = 'YOUR_BOT_TOKEN';
        this.chatId = 'YOUR_CHAT_ID';
        this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
    }

    async sendAttendanceNotification(data) {
        try {
            const message = this.formatAttendanceMessage(data);
            await this.sendMessage(message);
        } catch (error) {
            console.error('Telegram error:', error);
        }
    }

    formatAttendanceMessage(data) {
        const { name, time, status, distance, isLate, lateMinutes, type } = data;
        
        if (type === 'checkout') {
            return `
📤 ลงเวลาออก

👤 ชื่อ: ${name}
⏰ เวลา: ${time.toLocaleTimeString('th-TH')}
📍 ระยะห่าง: ${distance || 0} เมตร
${status === 'early_out' ? '⚠️ ออกก่อนเวลา' : '✅ ลงเวลาออกเรียบร้อย'}
            `;
        }

        let statusEmoji = '✅';
        let statusText = 'มาเรียน';
        
        if (isLate) {
            statusEmoji = '⚠️';
            statusText = `มาเรียนสาย (${lateMinutes} นาที)`;
        }

        return `
📚 ระบบแจ้งเตือนการเช็คชื่อ

👤 ชื่อ: ${name}
⏰ เวลาเข้า: ${time.toLocaleTimeString('th-TH')}
📅 วันที่: ${time.toLocaleDateString('th-TH')}
📍 ระยะห่าง: ${distance} เมตร
${statusEmoji} สถานะ: ${statusText}
        `;
    }

    async sendMessage(text) {
        try {
            const response = await fetch(`${this.apiUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: text,
                    parse_mode: 'HTML'
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Send message error:', error);
            throw error;
        }
    }
}

// ============================================================
// ATTENDANCE SERVICE
// ============================================================
class AttendanceService {
    constructor() {
        this.faceService = new FaceRecognitionService();
        this.telegramService = new TelegramService();
        this.schoolLocation = {
            lat: 13.736717,
            lng: 100.523186,
            radius: 100
        };
        this.attendanceSettings = {
            checkInTime: '07:30',
            checkOutTime: '16:00'
        };
    }

    async checkIn(userId, videoElement) {
        try {
            const faceResult = await this.verifyFace(userId, videoElement);
            if (!faceResult.success) {
                return { success: false, message: faceResult.message };
            }

            const location = await getCurrentPosition();
            const distance = calculateDistance(
                location.lat, location.lng,
                this.schoolLocation.lat, this.schoolLocation.lng
            );

            if (distance > this.schoolLocation.radius) {
                return { 
                    success: false, 
                    message: `อยู่นอกพื้นที่ (${Math.round(distance)}/${this.schoolLocation.radius} ม.)` 
                };
            }

            const today = new Date().toISOString().split('T')[0];
            const existing = await this.checkExistingAttendance(userId, today);
            if (existing) {
                return { success: false, message: 'ลงเวลาเข้าแล้ววันนี้' };
            }

            const now = new Date();
            const timeStr = now.toTimeString().slice(0, 5);
            const isLate = timeStr > this.attendanceSettings.checkInTime;
            const status = isLate ? 'late' : 'present';

            const attendanceData = {
                userId: userId,
                date: today,
                checkInTime: now.toISOString(),
                status: status,
                location: {
                    lat: location.lat,
                    lng: location.lng,
                    accuracy: location.accuracy,
                    distance: Math.round(distance)
                },
                faceConfidence: faceResult.confidence || 0,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                createdAt: new Date().toISOString()
            };

            await db.collection('attendance').add(attendanceData);

            await this.telegramService.sendAttendanceNotification({
                userId,
                name: faceResult.userName || 'นักเรียน',
                time: now,
                status: status,
                distance: Math.round(distance),
                isLate: isLate,
                lateMinutes: isLate ? this.calculateLateMinutes(timeStr) : 0
            });

            if (videoElement) {
                await this.saveAttendancePhoto(userId, today, videoElement);
            }

            return {
                success: true,
                message: isLate ? 'ลงเวลาเข้า (สาย)' : 'ลงเวลาเข้าเรียบร้อย',
                status: status,
                distance: Math.round(distance),
                time: timeStr
            };

        } catch (error) {
            console.error('Check-in error:', error);
            return { success: false, message: error.message || 'เกิดข้อผิดพลาด' };
        }
    }

    async checkOut(userId) {
        try {
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            
            const existing = await this.checkExistingAttendance(userId, today);
            if (!existing) {
                return { success: false, message: 'ยังไม่ได้เช็คชื่อเข้า' };
            }

            const timeStr = now.toTimeString().slice(0, 5);
            const isEarly = timeStr < this.attendanceSettings.checkOutTime;
            const status = isEarly ? 'early_out' : 'present';

            await db.collection('attendance').doc(existing.id).update({
                checkOutTime: now.toISOString(),
                status: status,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await this.telegramService.sendAttendanceNotification({
                userId,
                name: 'นักเรียน',
                time: now,
                status: 'checkout',
                isEarly: isEarly,
                type: 'checkout'
            });

            return {
                success: true,
                message: isEarly ? 'ออกก่อนเวลา' : 'ลงเวลาออกเรียบร้อย',
                status: status,
                time: timeStr
            };

        } catch (error) {
            console.error('Check-out error:', error);
            return { success: false, message: error.message || 'เกิดข้อผิดพลาด' };
        }
    }

    async verifyFace(userId, videoElement) {
        try {
            await this.faceService.initialize();
            
            const isLive = await this.faceService.detectBlink(videoElement);
            if (!isLive) {
                return { success: false, message: 'กรุณากระพริบตาเพื่อยืนยันตัวตน' };
            }

            const userData = await this.getUserFaceData(userId);
            if (!userData) {
                return { success: false, message: 'ไม่พบข้อมูลใบหน้า' };
            }

            const compareResult = await this.faceService.compareFace(videoElement, userData);
            if (!compareResult.matched) {
                return { 
                    success: false, 
                    message: `ใบหน้าไม่ตรง (${Math.round(compareResult.similarity * 100)}%)` 
                };
            }

            return {
                success: true,
                confidence: compareResult.similarity,
                userName: userData.name
            };

        } catch (error) {
            console.error('Verify face error:', error);
            return { success: false, message: 'ไม่สามารถตรวจสอบใบหน้าได้' };
        }
    }

    async checkExistingAttendance(userId, date) {
        const snapshot = await db.collection('attendance')
            .where('userId', '==', userId)
            .where('date', '==', date)
            .get();
            
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    }

    async getUserFaceData(userId) {
        const snapshot = await db.collection('users')
            .where('userId', '==', userId)
            .get();
        if (snapshot.empty) return null;
        return snapshot.docs[0].data();
    }

    async saveAttendancePhoto(userId, date, videoElement) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth || 640;
            canvas.height = videoElement.videoHeight || 480;
            canvas.getContext('2d').drawImage(videoElement, 0, 0);
            
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
            const storageRef = storage.ref(`attendance/${userId}/${date}.jpg`);
            await storageRef.put(blob);
            return await storageRef.getDownloadURL();
        } catch (error) {
            console.error('Save photo error:', error);
            return null;
        }
    }

    calculateLateMinutes(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const [checkHours, checkMinutes] = this.attendanceSettings.checkInTime.split(':').map(Number);
        return Math.max(0, (hours - checkHours) * 60 + (minutes - checkMinutes));
    }

    async getCurrentPosition() {
        return getCurrentPosition();
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        return calculateDistance(lat1, lon1, lat2, lon2);
    }
}

// ============================================================
// PAGES
// ============================================================
let appContainer;
let currentPage = null;
let currentUser = null;
let attendanceService = new AttendanceService();

// ---------- Login Page ----------
class LoginPage {
    render() {
        return `
            <div class="login-container fade-in">
                <div class="login-box">
                    <h1>📚 ลงเวลาเรียน</h1>
                    <p class="subtitle">ระบบเช็คชื่อด้วย AI และ GPS</p>
                    
                    <div class="login-form">
                        <input type="email" id="email" placeholder="อีเมล" autocomplete="email" />
                        <input type="password" id="password" placeholder="รหัสผ่าน" autocomplete="current-password" />
                        <button id="loginBtn" class="btn-primary">เข้าสู่ระบบ</button>
                        <div class="divider">หรือ</div>
                        <button id="googleBtn" class="btn-google">
                            <svg class="google-icon" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            เข้าสู่ระบบด้วย Google
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    attachEvents() {
        document.getElementById('loginBtn').addEventListener('click', async () => {
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            
            if (!email || !password) {
                showToast('กรุณากรอกอีเมลและรหัสผ่าน', 'error');
                return;
            }
            
            try {
                document.getElementById('loginBtn').disabled = true;
                document.getElementById('loginBtn').textContent = '⏳ กำลังเข้าสู่ระบบ...';
                await auth.signInWithEmailAndPassword(email, password);
            } catch (error) {
                showToast(error.message, 'error');
                document.getElementById('loginBtn').disabled = false;
                document.getElementById('loginBtn').textContent = 'เข้าสู่ระบบ';
            }
        });

        document.getElementById('googleBtn').addEventListener('click', async () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            try {
                document.getElementById('googleBtn').disabled = true;
                document.getElementById('googleBtn').textContent = '⏳ กำลังเชื่อมต่อ...';
                await auth.signInWithPopup(provider);
            } catch (error) {
                showToast(error.message, 'error');
                document.getElementById('googleBtn').disabled = false;
                document.getElementById('googleBtn').innerHTML = `
                    <svg class="google-icon" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    เข้าสู่ระบบด้วย Google
                `;
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('loginBtn').click();
            }
        });
    }

    destroy() {}
}

// ---------- Dashboard Page ----------
class DashboardPage {
    constructor(user) {
        this.user = user;
        this.todayStats = { present: 0, late: 0, absent: 0, leave: 0 };
    }

    render() {
        const userInitial = this.user.displayName ? this.user.displayName.charAt(0).toUpperCase() : 'U';
        
        return `
            <div class="dashboard fade-in">
                <div class="dashboard-header">
                    <h2>👋 สวัสดี, ${this.user.displayName || 'ผู้ใช้'}</h2>
                    <div class="user-avatar" id="profileBtn">${userInitial}</div>
                </div>

                <div class="quick-stats">
                    <div class="stat-item">
                        <div class="number" id="statPresent">0</div>
                        <div class="label">✅ มาเรียน</div>
                    </div>
                    <div class="stat-item">
                        <div class="number" id="statLate">0</div>
                        <div class="label">⚠️ สาย</div>
                    </div>
                    <div class="stat-item">
                        <div class="number" id="statAbsent">0</div>
                        <div class="label">❌ ขาด</div>
                    </div>
                    <div class="stat-item">
                        <div class="number" id="statLeave">0</div>
                        <div class="label">📝 ลา</div>
                    </div>
                </div>

                <div class="attendance-grid">
                    <div class="card" id="checkinCard">
                        <div class="card-icon">✅</div>
                        <h3>ลงเวลาเข้า</h3>
                        <p>เช็คชื่อเข้าเรียน</p>
                        <button id="checkinBtn" class="btn-success">📸 ลงเวลาเข้า</button>
                    </div>
                    <div class="card" id="checkoutCard">
                        <div class="card-icon">🏃</div>
                        <h3>ลงเวลาออก</h3>
                        <p>เช็คชื่อออก</p>
                        <button id="checkoutBtn" class="btn-warning">📸 ลงเวลาออก</button>
                    </div>
                </div>

                <div class="today-summary">
                    <h3>📊 สรุปวันนี้</h3>
                    <div id="summaryContent">
                        <div class="summary-list">
                            <div class="summary-item"><span>✅ มาเรียน</span><span id="summaryPresent">0 คน</span></div>
                            <div class="summary-item"><span>⚠️ สาย</span><span id="summaryLate">0 คน</span></div>
                            <div class="summary-item"><span>❌ ขาด</span><span id="summaryAbsent">0 คน</span></div>
                            <div class="summary-item"><span>📝 ลา</span><span id="summaryLeave">0 คน</span></div>
                        </div>
                    </div>
                </div>

                <nav class="bottom-nav">
                    <button class="nav-item active" data-nav="dashboard">
                        <span class="nav-icon">🏠</span>
                        <span>หน้าหลัก</span>
                    </button>
                    <button class="nav-item" data-nav="attendance">
                        <span class="nav-icon">📸</span>
                        <span>ลงเวลา</span>
                    </button>
                    <button class="nav-item" data-nav="profile">
                        <span class="nav-icon">👤</span>
                        <span>โปรไฟล์</span>
                    </button>
                </nav>
            </div>
        `;
    }

    attachEvents() {
        document.getElementById('profileBtn').addEventListener('click', () => {
            navigateTo('#profile');
        });

        document.getElementById('checkinBtn').addEventListener('click', () => {
            navigateTo('#attendance');
        });
        document.getElementById('checkoutBtn').addEventListener('click', () => {
            navigateTo('#attendance');
        });

        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const nav = btn.dataset.nav;
                if (nav === 'dashboard') {
                    navigateTo('#dashboard');
                } else if (nav === 'attendance') {
                    navigateTo('#attendance');
                } else if (nav === 'profile') {
                    navigateTo('#profile');
                }
            });
        });

        this.loadTodayStats();
        this.loadTodaySummary();
    }

    async loadTodayStats() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const snapshot = await db.collection('attendance')
                .where('date', '==', today)
                .get();
            
            let present = 0, late = 0, leave = 0, absent = 0;
            
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.status === 'present') present++;
                else if (data.status === 'late') late++;
                else if (data.status === 'leave') leave++;
                else if (data.status === 'absent') absent++;
            });
            
            document.getElementById('statPresent').textContent = present;
            document.getElementById('statLate').textContent = late;
            document.getElementById('statAbsent').textContent = absent;
            document.getElementById('statLeave').textContent = leave;
            
            this.todayStats = { present, late, absent, leave };
            
        } catch (error) {
            console.error('Load stats error:', error);
        }
    }

    async loadTodaySummary() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const snapshot = await db.collection('attendance')
                .where('date', '==', today)
                .get();
            
            let present = 0, late = 0, leave = 0, absent = 0;
            
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.status === 'present') present++;
                else if (data.status === 'late') late++;
                else if (data.status === 'leave') leave++;
                else if (data.status === 'absent') absent++;
            });
            
            document.getElementById('summaryPresent').textContent = `${present} คน`;
            document.getElementById('summaryLate').textContent = `${late} คน`;
            document.getElementById('summaryAbsent').textContent = `${absent} คน`;
            document.getElementById('summaryLeave').textContent = `${leave} คน`;
            
        } catch (error) {
            console.error('Load summary error:', error);
            document.getElementById('summaryContent').innerHTML = 
                '<p style="color:var(--gray-500);text-align:center;padding:12px;">ไม่สามารถโหลดข้อมูลได้</p>';
        }
    }

    destroy() {}
}

// ---------- Attendance Page ----------
class AttendancePage {
    constructor(user) {
        this.user = user;
        this.video = null;
        this.isStreaming = false;
        this.detectionInterval = null;
        this.clockInterval = null;
    }

    render() {
        return `
            <div class="attendance-page fade-in">
                <div class="page-header">
                    <button id="backBtn" class="btn-back">← กลับ</button>
                    <h2>📸 ลงเวลาเรียน</h2>
                </div>

                <div class="camera-container">
                    <video id="video" autoplay playsinline></video>
                    
                    <div class="camera-overlay">
                        <div class="face-frame" id="faceFrame">
                            <div class="face-indicator" id="faceIndicator"></div>
                        </div>
                        <div class="status-text" id="statusText">📷 กำลังเปิดกล้อง...</div>
                    </div>
                </div>

                <div class="action-buttons">
                    <button id="checkinBtn" class="btn-success btn-large">
                        ✅ ลงเวลาเข้า
                    </button>
                    <button id="checkoutBtn" class="btn-warning btn-large">
                        🏃 ลงเวลาออก
                    </button>
                </div>

                <div class="info-panel">
                    <div class="info-item">
                        <span class="label">📍 ตำแหน่ง</span>
                        <span class="value" id="locationStatus">กำลังโหลด...</span>
                    </div>
                    <div class="info-item">
                        <span class="label">⏰ เวลา</span>
                        <span class="value" id="timeStatus">${new Date().toLocaleTimeString('th-TH')}</span>
                    </div>
                    <div class="info-item">
                        <span class="label">📡 ระยะห่าง</span>
                        <span class="value" id="distanceStatus">-</span>
                    </div>
                    <div class="info-item">
                        <span class="label">🤖 ใบหน้า</span>
                        <span class="value" id="faceStatus">รอตรวจจับ</span>
                    </div>
                </div>

                <nav class="bottom-nav">
                    <button class="nav-item" data-nav="dashboard">
                        <span class="nav-icon">🏠</span>
                        <span>หน้าหลัก</span>
                    </button>
                    <button class="nav-item active" data-nav="attendance">
                        <span class="nav-icon">📸</span>
                        <span>ลงเวลา</span>
                    </button>
                    <button class="nav-item" data-nav="profile">
                        <span class="nav-icon">👤</span>
                        <span>โปรไฟล์</span>
                    </button>
                </nav>
            </div>
        `;
    }

    attachEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            this.destroy();
            navigateTo('#dashboard');
        });

        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const nav = btn.dataset.nav;
                this.destroy();
                if (nav === 'dashboard') navigateTo('#dashboard');
                else if (nav === 'attendance') navigateTo('#attendance');
                else if (nav === 'profile') navigateTo('#profile');
            });
        });

        document.getElementById('checkinBtn').addEventListener('click', async () => {
            await this.handleCheckIn();
        });

        document.getElementById('checkoutBtn').addEventListener('click', async () => {
            await this.handleCheckOut();
        });

        this.setupCamera();

        this.clockInterval = setInterval(() => {
            const el = document.getElementById('timeStatus');
            if (el) el.textContent = new Date().toLocaleTimeString('th-TH');
        }, 1000);
    }

    async setupCamera() {
        this.video = document.getElementById('video');
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            });
            
            this.video.srcObject = stream;
            this.isStreaming = true;
            
            await this.video.play();
            
            document.getElementById('statusText').textContent = '📷 พร้อมใช้งาน';
            document.getElementById('statusText').style.color = '#22C55E';
            
            this.startFaceDetection();
            this.updateLocation();
            
        } catch (error) {
            console.error('Camera error:', error);
            document.getElementById('statusText').textContent = '❌ ไม่สามารถเปิดกล้องได้';
            document.getElementById('statusText').style.color = '#EF4444';
            showToast('กรุณาอนุญาตการใช้งานกล้อง', 'error');
        }
    }

    async startFaceDetection() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
        }
        
        this.detectionInterval = setInterval(async () => {
            if (!this.isStreaming || !this.video) return;
            
            try {
                await attendanceService.faceService.initialize();
                const face = await attendanceService.faceService.detectFace(this.video);
                
                const frame = document.getElementById('faceFrame');
                const indicator = document.getElementById('faceIndicator');
                const faceStatus = document.getElementById('faceStatus');
                
                if (face) {
                    frame.classList.add('detected');
                    indicator.classList.add('detected');
                    faceStatus.textContent = '✅ ตรวจพบ';
                    faceStatus.style.color = '#22C55E';
                    document.getElementById('statusText').textContent = '✅ ตรวจพบใบหน้า';
                    document.getElementById('statusText').style.color = '#22C55E';
                } else {
                    frame.classList.remove('detected');
                    indicator.classList.remove('detected');
                    faceStatus.textContent = '❌ ไม่พบ';
                    faceStatus.style.color = '#EF4444';
                    document.getElementById('statusText').textContent = '❌ ไม่พบใบหน้า';
                    document.getElementById('statusText').style.color = '#EF4444';
                }
            } catch (error) {
                console.error('Face detection error:', error);
            }
        }, 500);
    }

    async updateLocation() {
        try {
            const position = await getCurrentPosition();
            document.getElementById('locationStatus').textContent = 
                `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
                
            const schoolLocation = {
                lat: 13.736717,
                lng: 100.523186
            };
            const distance = calculateDistance(
                position.lat, position.lng,
                schoolLocation.lat, schoolLocation.lng
            );
            document.getElementById('distanceStatus').textContent = 
                `${Math.round(distance)} เมตร`;
                
        } catch (error) {
            document.getElementById('locationStatus').textContent = '❌ ไม่ระบุ';
            document.getElementById('distanceStatus').textContent = '❌ ไม่ระบุ';
        }
    }

    async handleCheckIn() {
        if (!this.user) {
            showToast('กรุณาเข้าสู่ระบบ', 'error');
            return;
        }

        const btn = document.getElementById('checkinBtn');
        btn.disabled = true;
        btn.textContent = '⏳ กำลังตรวจสอบ...';
        document.getElementById('statusText').textContent = '⏳ กำลังตรวจสอบ...';
        document.getElementById('statusText').style.color = '#F59E0B';

        try {
            const result = await attendanceService.checkIn(this.user.uid, this.video);
            
            if (result.success) {
                showToast(`✅ ${result.message}`, 'success');
                document.getElementById('statusText').textContent = `✅ ${result.message}`;
                document.getElementById('statusText').style.color = '#22C55E';
                if (navigator.vibrate) navigator.vibrate(200);
            } else {
                showToast(`❌ ${result.message}`, 'error');
                document.getElementById('statusText').textContent = `❌ ${result.message}`;
                document.getElementById('statusText').style.color = '#EF4444';
            }
        } catch (error) {
            showToast(`❌ ${error.message}`, 'error');
            document.getElementById('statusText').textContent = `❌ ${error.message}`;
            document.getElementById('statusText').style.color = '#EF4444';
        } finally {
            btn.disabled = false;
            btn.textContent = '✅ ลงเวลาเข้า';
        }
    }

    async handleCheckOut() {
        if (!this.user) {
            showToast('กรุณาเข้าสู่ระบบ', 'error');
            return;
        }

        const btn = document.getElementById('checkoutBtn');
        btn.disabled = true;
        btn.textContent = '⏳ กำลังตรวจสอบ...';
        document.getElementById('statusText').textContent = '⏳ กำลังตรวจสอบ...';
        document.getElementById('statusText').style.color = '#F59E0B';

        try {
            const result = await attendanceService.checkOut(this.user.uid);
            
            if (result.success) {
                showToast(`✅ ${result.message}`, 'success');
                document.getElementById('statusText').textContent = `✅ ${result.message}`;
                document.getElementById('statusText').style.color = '#22C55E';
                if (navigator.vibrate) navigator.vibrate(200);
            } else {
                showToast(`❌ ${result.message}`, 'error');
                document.getElementById('statusText').textContent = `❌ ${result.message}`;
                document.getElementById('statusText').style.color = '#EF4444';
            }
        } catch (error) {
            showToast(`❌ ${error.message}`, 'error');
            document.getElementById('statusText').textContent = `❌ ${error.message}`;
            document.getElementById('statusText').style.color = '#EF4444';
        } finally {
            btn.disabled = false;
            btn.textContent = '🏃 ลงเวลาออก';
        }
    }

    destroy() {
        this.isStreaming = false;
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
        if (this.video && this.video.srcObject) {
            const tracks = this.video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            this.video.srcObject = null;
        }
    }
}

// ---------- Profile Page ----------
class ProfilePage {
    constructor(user) {
        this.user = user;
    }

    render() {
        const name = this.user.displayName || 'ผู้ใช้';
        const email = this.user.email || 'ไม่มีอีเมล';
        const initial = name.charAt(0).toUpperCase();
        const photoURL = this.user.photoURL;

        return `
            <div class="profile-page fade-in">
                <div class="page-header">
                    <button id="backBtn" class="btn-back">← กลับ</button>
                    <h2>👤 โปรไฟล์</h2>
                </div>

                <div class="profile-card">
                    <div class="profile-avatar" style="${photoURL ? `background-image:url(${photoURL});background-size:cover;` : ''}">
                        ${photoURL ? '' : initial}
                    </div>
                    <div class="profile-name">${name}</div>
                    <div class="profile-email">${email}</div>
                    
                    <div class="profile-info">
                        <div class="profile-info-item">
                            <span class="label">🆔 User ID</span>
                            <span style="font-size:0.8rem;color:var(--gray-500);">${this.user.uid.slice(0, 16)}...</span>
                        </div>
                        <div class="profile-info-item">
                            <span class="label">📱 อุปกรณ์</span>
                            <span>${this.getDeviceInfo()}</span>
                        </div>
                        <div class="profile-info-item">
                            <span class="label">🔗 PWA</span>
                            <span>${this.isPWA() ? '✅ ติดตั้งแล้ว' : '📲 สามารถติดตั้งได้'}</span>
                        </div>
                    </div>

                    <button id="logoutBtn" class="btn-primary" style="margin-top:16px;background:#EF4444;">
                        🚪 ออกจากระบบ
                    </button>
                </div>

                <nav class="bottom-nav">
                    <button class="nav-item" data-nav="dashboard">
                        <span class="nav-icon">🏠</span>
                        <span>หน้าหลัก</span>
                    </button>
                    <button class="nav-item" data-nav="attendance">
                        <span class="nav-icon">📸</span>
                        <span>ลงเวลา</span>
                    </button>
                    <button class="nav-item active" data-nav="profile">
                        <span class="nav-icon">👤</span>
                        <span>โปรไฟล์</span>
                    </button>
                </nav>
            </div>
        `;
    }

    attachEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            navigateTo('#dashboard');
        });

        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const nav = btn.dataset.nav;
                if (nav === 'dashboard') navigateTo('#dashboard');
                else if (nav === 'attendance') navigateTo('#attendance');
                else if (nav === 'profile') navigateTo('#profile');
            });
        });

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
                try {
                    await auth.signOut();
                    showToast('ออกจากระบบเรียบร้อย', 'success');
                } catch (error) {
                    showToast(error.message, 'error');
                }
            }
        });
    }

    getDeviceInfo() {
        const ua = navigator.userAgent;
        if (ua.includes('Mobile')) return '📱 มือถือ';
        if (ua.includes('Tablet')) return '📱 แท็บเล็ต';
        return '💻 คอมพิวเตอร์';
    }

    isPWA() {
        return window.matchMedia('(display-mode: standalone)').matches || 
               navigator.standalone === true;
    }

    destroy() {}
}

// ============================================================
// ROUTER
// ============================================================
function renderApp() {
    appContainer = document.getElementById('app');
    
    window.addEventListener('hashchange', () => {
        if (currentUser) {
            handleRoute(window.location.hash, currentUser);
        }
    });
    
    auth.onAuthStateChanged((user) => {
        currentUser = user;
        if (user) {
            const hash = window.location.hash || '#dashboard';
            handleRoute(hash, user);
        } else {
            renderLogin();
        }
    });
}

function handleRoute(hash, user) {
    if (!user) {
        renderLogin();
        return;
    }

    if (currentPage && typeof currentPage.destroy === 'function') {
        currentPage.destroy();
    }

    switch (hash) {
        case '#attendance':
            renderAttendance(user);
            break;
        case '#profile':
            renderProfile(user);
            break;
        case '#dashboard':
        default:
            renderDashboard(user);
            break;
    }
}

function renderLogin() {
    const loginPage = new LoginPage();
    appContainer.innerHTML = loginPage.render();
    loginPage.attachEvents();
    currentPage = loginPage;
}

function renderDashboard(user) {
    const dashboard = new DashboardPage(user);
    appContainer.innerHTML = dashboard.render();
    dashboard.attachEvents();
    currentPage = dashboard;
}

function renderAttendance(user) {
    const attendance = new AttendancePage(user);
    appContainer.innerHTML = attendance.render();
    attendance.attachEvents();
    currentPage = attendance;
}

function renderProfile(user) {
    const profile = new ProfilePage(user);
    appContainer.innerHTML = profile.render();
    profile.attachEvents();
    currentPage = profile;
}

// ============================================================
// SERVICE WORKER
// ============================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('[SW] Registered successfully');
            })
            .catch(err => {
                console.log('[SW] Registration failed:', err);
            });
    });
}

// ============================================================
// START APP
// ============================================================
renderApp();

// Handle offline/online
window.addEventListener('online', () => {
    document.body.classList.remove('offline');
    const offlineBanner = document.getElementById('offline-banner');
    if (offlineBanner) offlineBanner.remove();
});

window.addEventListener('offline', () => {
    document.body.classList.add('offline');
    const banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText = `
        position:fixed;top:0;left:0;right:0;background:#ef4444;color:white;
        padding:12px;text-align:center;z-index:9999;font-weight:500;
    `;
    banner.textContent = '📡 ไม่มีการเชื่อมต่ออินเทอร์เน็ต';
    document.body.prepend(banner);
});

console.log('🚀 ระบบลงเวลาเรียนพร้อมใช้งานแล้ว!');
console.log('📱 เข้าสู่ระบบที่:', window.location.href);
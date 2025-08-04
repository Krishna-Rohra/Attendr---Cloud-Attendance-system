// Appwrite Configuration
const { Client, Databases, Storage, ID, Query } = Appwrite;

// Initialize Appwrite client
const client = new Client()
  .setEndpoint('https://LOCATION.cloud.appwrite.io/v1') // Your Appwrite endpoint
  .setProject('PROJECT_ID'); // Your project ID

const databases = new Databases(client);
const storage = new Storage(client);
const account = new Appwrite.Account(client);

// Database and Collection IDs
const DATABASE_ID = 'DATABASE_ID';
const STUDENTS_COLLECTION_ID = 'STUDENTS_COLLECTION_ID';
const ATTENDANCE_COLLECTION_ID = 'ATTENDANCE_COLLECTION_ID';
const CONFIG_COLLECTION_ID = 'CONFIG_COLLECTION_ID';
const STORAGE_BUCKET_ID = 'STORAGE_BUCKET_ID';

// Global variables
let currentUser = null;
let currentUserType = null;
let students = [];
let attendanceRecords = [];
let config = { studentAuthEnabled: true };
let cameraStream = null;
let currentStudentPhoto = null;
let faceApiLoaded = false;
let loginAttempts = { admin: 0, lastAttempt: 0, lockoutUntil: 0 };

async function initializeFaceAPI() {
  try {
    console.log('Loading Face-API models...');

    const MODEL_URI = '/models'; // use local folder

    const loadModel = async (modelLoader, modelName) => {
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Loading ${modelName} (attempt ${attempt}/${maxRetries})...`);
          await Promise.race([
            modelLoader.loadFromUri(MODEL_URI),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Timeout while loading ' + modelName)), 30000)
            )
          ]);
          console.log(`${modelName} loaded successfully`);
          return;
        } catch (error) {
          console.warn(`Failed to load ${modelName} (attempt ${attempt}):`, error.message);
          if (attempt === maxRetries) throw error;
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2s backoff
        }
      }
    };

    // Load all models in parallel
    await Promise.all([
      loadModel(faceapi.nets.tinyFaceDetector, 'TinyFaceDetector'),
      loadModel(faceapi.nets.faceLandmark68Net, 'FaceLandmark68Net'),
      loadModel(faceapi.nets.faceRecognitionNet, 'FaceRecognitionNet'),
      loadModel(faceapi.nets.ssdMobilenetv1, 'SsdMobilenetv1')
    ]);

    faceApiLoaded = true;
    console.log(' All Face-API models loaded successfully');
  } catch (error) {
    console.error(' Error loading Face-API models:', error.message);
    faceApiLoaded = false;
  }
}


// Initialize the application
async function init() {
  try {
    updateCurrentDate();
    await initializeFaceAPI();

    try {
      console.log('Initializing with Appwrite...');
      await loadConfigFromAppwrite();
      await loadStudentsFromAppwrite();
      await syncAttendanceRecords(); // Use sync instead of just load
      
      // Force update dashboard after loading
      updateDashboard();
      
      console.log('Appwrite initialization completed');
    } catch (error) {
      console.log('Appwrite not configured, using localStorage:', error);
      students = JSON.parse(localStorage.getItem('students') || '[]');
      attendanceRecords = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
      config = JSON.parse(localStorage.getItem('config') || '{"studentAuthEnabled": true}');
      
      // Update dashboard with localStorage data
      updateDashboard();
    }

    document.getElementById('authToggle').checked = config.studentAuthEnabled;
    console.log('Application initialized successfully');
    
    // Show debug info after initialization
    setTimeout(() => {
      console.log('=== POST-INITIALIZATION DEBUG ===');
      debugAttendanceData();
    }, 1000);
    
  } catch (error) {
    console.error('Error initializing application:', error);
  }
}

// Update current date display
function updateCurrentDate() {
  const now = new Date();
  const options = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };
  document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', options);
}

// Handle login type change
document.getElementById('loginType').addEventListener('change', function () {
  const loginType = this.value;
  const adminForm = document.getElementById('adminLoginForm');
  const studentForm = document.getElementById('studentLoginForm');

  if (loginType === 'admin') {
    adminForm.classList.remove('hidden');
    studentForm.classList.add('hidden');
  } else {
    adminForm.classList.add('hidden');
    studentForm.classList.remove('hidden');
  }
});

// Login button
document.getElementById('loginBtn').addEventListener('click', handleLogin);
document.getElementById('logoutAdmin').addEventListener('click', logout);
document.getElementById('logoutStudent').addEventListener('click', logout);
document.getElementById('addStudentBtn').addEventListener('click', showAddStudentModal);
document.getElementById('viewStudentsBtn').addEventListener('click', showStudentsList);
document.getElementById('viewAttendanceDetailsBtn').addEventListener('click', showAttendanceDetails);
document.getElementById('markAttendanceBtn').addEventListener('click', markAttendance);
document.getElementById('uploadFromPC').addEventListener('click', openFileInput);
document.getElementById('takePhotoBtn').addEventListener('click', openCamera);
document.getElementById('photoInput').addEventListener('change', handlePhotoUpload);
document.getElementById('capturePhotoBtn').addEventListener('click', capturePhoto);
document.getElementById('cancelCameraBtn').addEventListener('click', closeCamera);
document.getElementById('removePhotoBtn').addEventListener('click', removePhoto);
document.getElementById('saveStudentBtn').addEventListener('click', saveStudent);
document.getElementById('captureAttendanceBtn').addEventListener('click', captureAttendance);
document.getElementById('authToggle').addEventListener('change', toggleStudentAuth);

// Enhanced login handler with improved rate limiting and proper student authentication
async function handleLogin() {
  const loginType = document.getElementById('loginType').value;
  const messageDiv = document.getElementById('loginMessage');
  const loginBtn = document.getElementById('loginBtn');

  // Disable button to prevent multiple clicks
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';

  try {
    if (loginType === 'admin') {
      await handleAdminLogin(messageDiv);
    } else {
      await handleStudentLogin(messageDiv);
    }
  } catch (error) {
    console.error('Login error:', error);
    messageDiv.innerHTML = `<div class="error-message">Login failed: ${error.message}</div>`;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
}

// Enhanced admin login with improved rate limiting and error handling
async function handleAdminLogin(messageDiv) {
  const input = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value;

  // Check if currently locked out
  const now = Date.now();
  if (loginAttempts.lockoutUntil > now) {
    const remainingTime = Math.ceil((loginAttempts.lockoutUntil - now) / 1000);
    messageDiv.innerHTML = `<div class="error-message">Account temporarily locked. Please wait ${remainingTime} seconds before trying again.</div>`;
    return;
  }

  // Reset lockout if time has passed
  if (loginAttempts.lockoutUntil <= now) {
    loginAttempts.admin = 0;
    loginAttempts.lockoutUntil = 0;
  }

  const usernameToEmail = { 'admin': 'admin@gmail.com' };
  const email = usernameToEmail[input.toLowerCase()];
  
  if (!email) {
    messageDiv.innerHTML = '<div class="error-message">Unknown admin username</div>';
    return;
  }

  try {
    // Clear any existing session
    await account.deleteSession('current').catch(() => {});
    
    // Attempt login
    await account.createEmailSession(email, password);
    
    // Reset login attempts on success
    loginAttempts.admin = 0;
    loginAttempts.lastAttempt = 0;
    loginAttempts.lockoutUntil = 0;

    currentUser = { type: 'admin', email };
    currentUserType = 'admin';
    showAdminDashboard();
    messageDiv.innerHTML = '<div class="success-message">Admin login successful!</div>';

    await loadConfigFromAppwrite();
    await loadStudentsFromAppwrite();
    await loadAttendanceFromAppwrite();
    updateDashboard();
    document.getElementById('authToggle').checked = config.studentAuthEnabled;
    
  } catch (error) {
    loginAttempts.admin++;
    loginAttempts.lastAttempt = now;
    
    console.error('Admin login failed:', error);
    
    // Handle different types of errors
    if (error.code === 429 || error.message?.toLowerCase().includes('rate limit') || error.message?.toLowerCase().includes('too many requests')) {
      // Appwrite rate limit hit
      loginAttempts.lockoutUntil = now + 60000; // Lock for 60 seconds
      messageDiv.innerHTML = '<div class="error-message">Your login limit is reached. Please try after 60 seconds.</div>';
    } else if (error.code === 401 || error.message?.toLowerCase().includes('invalid credentials')) {
      // Invalid credentials
      if (loginAttempts.admin >= 3) {
        loginAttempts.lockoutUntil = now + 60000; // Lock for 60 seconds after 3 failed attempts
        messageDiv.innerHTML = '<div class="error-message">Too many failed attempts. Please wait 60 seconds before trying again.</div>';
      } else {
        messageDiv.innerHTML = `<div class="error-message">Invalid credentials. ${3 - loginAttempts.admin} attempts remaining.</div>`;
      }
    } else {
      // Other errors
      messageDiv.innerHTML = `<div class="error-message">Login failed: ${error.message || 'Unknown error'}</div>`;
    }
  }
}

// Handle student login
async function handleStudentLogin(messageDiv) {
  const roll = document.getElementById('studentRoll').value.trim();

  if (!roll) {
    messageDiv.innerHTML = '<div class="error-message">Please enter your roll number</div>';
    return;
  }

  if (!config.studentAuthEnabled) {
    messageDiv.innerHTML = '<div class="error-message">Student authentication is currently disabled!</div>';
    return;
  }

  try {
    // Find student in database
    const student = students.find(s => s.roll === roll && s.status === 'active');
    
    if (!student) {
      messageDiv.innerHTML = '<div class="error-message">Invalid roll number or student not found!</div>';
      return;
    }

    currentUser = student;
    currentUserType = 'student';
    showStudentDashboard();
    messageDiv.innerHTML = '<div class="success-message">Student login successful!</div>';
    
  } catch (error) {
    console.error('Student login failed:', error);
    messageDiv.innerHTML = '<div class="error-message">Student login failed. Please try again.</div>';
  }
}

// Show admin dashboard
function showAdminDashboard() {
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'block';
  document.getElementById('studentDashboard').style.display = 'none';
  updateDashboard();
}

// Show student dashboard
function showStudentDashboard() {
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'none';
  document.getElementById('studentDashboard').style.display = 'block';
  updateStudentDashboard();
}

// Update dashboard statistics
function updateDashboard() {
  const totalStudents = students.filter(s => s.status === 'active').length;
  
  // Get today's date in local timezone to avoid timezone issues
  const now = new Date();
  const today = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
  
  const todayAttendance = attendanceRecords.filter(r => r.date === today);
  const presentToday = todayAttendance.length;
  const absentToday = Math.max(0, totalStudents - presentToday);

  console.log('Dashboard Update:', {
    totalStudents,
    today,
    todayAttendance: todayAttendance.length,
    presentToday,
    absentToday,
    allAttendanceRecords: attendanceRecords.length,
    sampleRecords: attendanceRecords.slice(0, 3).map(r => ({ date: r.date, studentRoll: r.studentRoll }))
  });

  document.getElementById('totalStudents').textContent = totalStudents;
  document.getElementById('presentToday').textContent = presentToday;
  document.getElementById('absentToday').textContent = absentToday;
}

async function refreshDashboardData() {
  const refreshBtn = document.getElementById('refreshDashboardBtn');
  const originalText = refreshBtn.innerHTML;
  
  try {
    refreshBtn.innerHTML = '🔄 Refreshing...';
    refreshBtn.disabled = true;
    
    console.log('Refreshing dashboard data from Appwrite...');
    await loadStudentsFromAppwrite();
    await syncAttendanceRecords();
    updateDashboard();
    console.log('Dashboard data refreshed successfully');
    
    // Show success feedback
    refreshBtn.innerHTML = '✅ Refreshed!';
    setTimeout(() => {
      refreshBtn.innerHTML = originalText;
      refreshBtn.disabled = false;
    }, 2000);
  } catch (error) {
    console.error('Error refreshing dashboard data:', error);
    refreshBtn.innerHTML = '❌ Error!';
    setTimeout(() => {
      refreshBtn.innerHTML = originalText;
      refreshBtn.disabled = false;
    }, 2000);
  }
}

async function forceSyncAttendanceData() {
  try {
    console.log('Force syncing attendance data...');
    
    // Clear local cache and reload from Appwrite
    attendanceRecords = [];
    localStorage.removeItem('attendanceRecords');
    
    await syncAttendanceRecords();
    updateDashboard();
    
    console.log('Force sync completed successfully');
    return true;
  } catch (error) {
    console.error('Error during force sync:', error);
    return false;
  }
}

function exportAttendanceData() {
  try {
    const exportData = {
      students: students,
      attendanceRecords: attendanceRecords,
      config: config,
      exportDate: new Date().toISOString(),
      totalStudents: students.filter(s => s.status === 'active').length,
      totalAttendanceRecords: attendanceRecords.length
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `attendance_data_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    
    console.log('Attendance data exported successfully');
  } catch (error) {
    console.error('Error exporting attendance data:', error);
    alert('Error exporting data: ' + error.message);
  }
}

// Generate and download detailed attendance list with photos
async function downloadAttendanceList() {
  try {
    console.log('Generating attendance list...');
    
    // Get today's date in local timezone
    const now = new Date();
    const today = now.getFullYear() + '-' + 
                  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(now.getDate()).padStart(2, '0');
    
    const activeStudents = students.filter(s => s.status === 'active');
    const todayAttendance = attendanceRecords.filter(r => r.date === today);
    
    // Create HTML content for the attendance list
    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Attendance List - ${today}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .header h1 { color: #364958; margin-bottom: 10px; }
          .header p { color: #87bba2; font-size: 16px; }
          .summary { background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 30px; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
          .summary-item { text-align: center; }
          .summary-number { font-size: 2em; font-weight: bold; color: #364958; }
          .summary-label { color: #87bba2; font-size: 14px; }
          .student-list { display: grid; gap: 15px; }
          .student-card { 
            border: 1px solid #e0e0e0; 
            border-radius: 10px; 
            padding: 20px; 
            display: flex; 
            align-items: center; 
            gap: 20px;
            background: white;
          }
          .student-photo { 
            width: 80px; 
            height: 80px; 
            border-radius: 50%; 
            object-fit: cover; 
            border: 3px solid #e0e0e0;
          }
          .student-info { flex: 1; }
          .student-name { font-size: 18px; font-weight: bold; color: #364958; margin-bottom: 5px; }
          .student-roll { color: #87bba2; font-size: 14px; margin-bottom: 5px; }
          .attendance-status { 
            padding: 8px 16px; 
            border-radius: 20px; 
            font-weight: bold; 
            text-align: center;
            min-width: 100px;
          }
          .status-present { background: #d4edda; color: #155724; }
          .status-absent { background: #f8d7da; color: #721c24; }
          .timestamp { font-size: 12px; color: #6c757d; margin-top: 5px; }
          .footer { margin-top: 30px; text-align: center; color: #6c757d; font-size: 12px; }
          @media print {
            body { margin: 10px; }
            .student-card { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📊 Attendance Report</h1>
          <p>Date: ${new Date(today).toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}</p>
        </div>
        
        <div class="summary">
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-number">${activeStudents.length}</div>
              <div class="summary-label">Total Students</div>
            </div>
            <div class="summary-item">
              <div class="summary-number">${todayAttendance.length}</div>
              <div class="summary-label">Present Today</div>
            </div>
            <div class="summary-item">
              <div class="summary-number">${activeStudents.length - todayAttendance.length}</div>
              <div class="summary-label">Absent Today</div>
            </div>
          </div>
        </div>
        
        <div class="student-list">
    `;
    
    // Add each student to the list
    for (const student of activeStudents) {
      const attendanceRecord = todayAttendance.find(r => r.studentRoll === student.roll);
      const isPresent = !!attendanceRecord;
      
      htmlContent += `
        <div class="student-card">
          <img src="${student.photoUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNDAiIGN5PSI0MCIgcj0iNDAiIGZpbGw9IiNlOWVjZWYiLz4KPHBhdGggZD0iTTQwIDQwQzQ0LjE4NDggNDAgNDcuNSAzNi42ODQ4IDQ3LjUgMzIuNUM0Ny41IDI4LjMxNTIgNDQuMTg0OCAyNSA0MCAyNUMzNS44MTUyIDI1IDMyLjUgMjguMzE1MiAzMi41IDMyLjVDMzIuNSAzNi42ODQ4IDM1LjgxNTIgNDAgNDAgNDBaIiBmaWxsPSIjOTNhM2FmIi8+CjxwYXRoIGQ9Ik00MCA0NEMyOS41MTQ3IDQ0IDIxIDM1LjQ4NTMgMjEgMjVIMTlDMTkgMzYuNTk4IDI4LjQwMiA0NiA0MCA0NlY0NFoiIGZpbGw9IiM5M2EzYWYiLz4KPC9zdmc+'}" 
               alt="${student.name}" 
               class="student-photo" 
               onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNDAiIGN5PSI0MCIgcj0iNDAiIGZpbGw9IiNlOWVjZWYiLz4KPHBhdGggZD0iTTQwIDQwQzQ0LjE4NDggNDAgNDcuNSAzNi42ODQ4IDQ3LjUgMzIuNUM0Ny41IDI4LjMxNTIgNDQuMTg0OCAyNSA0MCAyNUMzNS44MTUyIDI1IDMyLjUgMjguMzE1MiAzMi41IDMyLjVDMzIuNSAzNi42ODQ4IDM1LjgxNTIgNDAgNDAgNDBaIiBmaWxsPSIjOTNhM2FmIi8+CjxwYXRoIGQ9Ik00MCA0NEMyOS41MTQ3IDQ0IDIxIDM1LjQ4NTMgMjEgMjVIMTlDMTkgMzYuNTk4IDI4LjQwMiA0NiA0MCA0NlY0NFoiIGZpbGw9IiM5M2EzYWYiLz4KPC9zdmc+'">
          <div class="student-info">
            <div class="student-name">${student.name}</div>
            <div class="student-roll">Roll Number: ${student.roll}</div>
            ${isPresent ? `<div class="timestamp">Marked at: ${new Date(attendanceRecord.timestamp).toLocaleTimeString()}</div>` : ''}
          </div>
          <div class="attendance-status ${isPresent ? 'status-present' : 'status-absent'}">
            ${isPresent ? '✅ Present' : '❌ Absent'}
          </div>
        </div>
      `;
    }
    
    htmlContent += `
        </div>
        
        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()} | Attendr - Smart Attendance System</p>
        </div>
      </body>
      </html>
    `;
    
    // Create and download the file
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance_list_${today}.html`;
    link.click();
    
    // Clean up
    URL.revokeObjectURL(url);
    
    console.log('Attendance list downloaded successfully');
    alert('Attendance list downloaded successfully!');
    
  } catch (error) {
    console.error('Error generating attendance list:', error);
    alert('Error generating attendance list: ' + error.message);
  }
}

// Generate and download attendance list as PDF (alternative)
async function downloadAttendanceListPDF() {
  try {
    console.log('Generating PDF attendance list...');
    
    // Get today's date in local timezone
    const now = new Date();
    const today = now.getFullYear() + '-' + 
                  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(now.getDate()).padStart(2, '0');
    
    const activeStudents = students.filter(s => s.status === 'active');
    const todayAttendance = attendanceRecords.filter(r => r.date === today);
    
    // Create CSV content for the attendance list
    let csvContent = 'Name,Roll Number,Status,Timestamp\n';
    
    // Add each student to the CSV
    for (const student of activeStudents) {
      const attendanceRecord = todayAttendance.find(r => r.studentRoll === student.roll);
      const isPresent = !!attendanceRecord;
      const timestamp = isPresent ? new Date(attendanceRecord.timestamp).toLocaleString() : '';
      
      csvContent += `"${student.name}","${student.roll}","${isPresent ? 'Present' : 'Absent'}","${timestamp}"\n`;
    }
    
    // Create and download the CSV file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance_list_${today}.csv`;
    link.click();
    
    // Clean up
    URL.revokeObjectURL(url);
    
    console.log('Attendance list CSV downloaded successfully');
    alert('Attendance list CSV downloaded successfully!');
    
  } catch (error) {
    console.error('Error generating attendance list CSV:', error);
    alert('Error generating attendance list CSV: ' + error.message);
  }
}

function repairAttendanceData() {
  try {
    console.log('Repairing attendance data...');
    
    // Remove invalid records
    const validRecords = attendanceRecords.filter(record => 
      record && 
      record.studentRoll && 
      record.date && 
      typeof record.studentRoll === 'string' &&
      typeof record.date === 'string'
    );
    
    // Remove duplicates
    const uniqueRecords = validRecords.filter((record, index, self) =>
      index === self.findIndex(r => 
        r.studentRoll === record.studentRoll && r.date === record.date
      )
    );
    
    const removedCount = attendanceRecords.length - uniqueRecords.length;
    attendanceRecords = uniqueRecords;
    
    // Update localStorage
    localStorage.setItem('attendanceRecords', JSON.stringify(uniqueRecords));
    
    // Update dashboard
    updateDashboard();
    
    console.log(`Attendance data repaired. Removed ${removedCount} invalid/duplicate records.`);
    alert(`Attendance data repaired successfully! Removed ${removedCount} invalid/duplicate records.`);
    
    return true;
  } catch (error) {
    console.error('Error repairing attendance data:', error);
    alert('Error repairing data: ' + error.message);
    return false;
  }
}

function showAttendanceStatistics() {
  try {
    const totalStudents = students.filter(s => s.status === 'active').length;
    const totalRecords = attendanceRecords.length;
    const today = new Date().toISOString().split('T')[0];
    const todayRecords = attendanceRecords.filter(r => r.date === today);
    
    // Get unique dates
    const uniqueDates = [...new Set(attendanceRecords.map(r => r.date))].sort();
    
    // Calculate average attendance per day
    const averageAttendance = uniqueDates.length > 0 
      ? (totalRecords / uniqueDates.length).toFixed(1) 
      : 0;
    
    // Get most recent attendance
    const mostRecent = attendanceRecords
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    
    const stats = {
      totalStudents,
      totalAttendanceRecords: totalRecords,
      uniqueDays: uniqueDates.length,
      averageAttendancePerDay: averageAttendance,
      todayAttendance: todayRecords.length,
      mostRecentAttendance: mostRecent ? new Date(mostRecent.timestamp).toLocaleString() : 'None',
      dataIntegrity: {
        validRecords: attendanceRecords.filter(r => r && r.studentRoll && r.date).length,
        totalRecords,
        percentage: totalRecords > 0 ? Math.round((attendanceRecords.filter(r => r && r.studentRoll && r.date).length / totalRecords) * 100) : 0
      }
    };
    
    const statsText = `
Attendance Statistics:

📊 Total Students: ${stats.totalStudents}
📈 Total Attendance Records: ${stats.totalAttendanceRecords}
📅 Unique Days: ${stats.uniqueDays}
📊 Average Attendance/Day: ${stats.averageAttendancePerDay}
📆 Today's Attendance: ${stats.todayAttendance}
🕒 Most Recent: ${stats.mostRecentAttendance}
🔍 Data Integrity: ${stats.dataIntegrity.percentage}% (${stats.dataIntegrity.validRecords}/${stats.dataIntegrity.totalRecords})

Last 5 Attendance Days:
${uniqueDates.slice(-5).map(date => `  • ${date}: ${attendanceRecords.filter(r => r.date === date).length} students`).join('\n')}
    `;
    
    alert(statsText);
    console.log('Attendance statistics:', stats);
  } catch (error) {
    console.error('Error showing attendance statistics:', error);
    alert('Error showing statistics: ' + error.message);
  }
}

// Debug function to help troubleshoot attendance issues
function debugAttendanceData() {
  console.log('=== ATTENDANCE DEBUG INFO ===');
  
  // Get today's date in local timezone
  const now = new Date();
  const today = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
  
  console.log('Current date (local):', today);
  console.log('Current date (ISO):', new Date().toISOString().split('T')[0]);
  
  console.log('Total students:', students.length);
  console.log('Active students:', students.filter(s => s.status === 'active').length);
  console.log('Total attendance records:', attendanceRecords.length);
  
  // Check for today's attendance
  const todayAttendance = attendanceRecords.filter(r => r.date === today);
  console.log('Today\'s attendance records:', todayAttendance);
  
  // Check for any attendance records
  console.log('All attendance records:', attendanceRecords);
  
  // Check for date format inconsistencies
  const uniqueDates = [...new Set(attendanceRecords.map(r => r.date))];
  console.log('Unique dates in records:', uniqueDates);
  
  // Check for students with attendance
  const studentsWithAttendance = students.filter(s => 
    attendanceRecords.some(r => r.studentRoll === s.roll)
  );
  console.log('Students with attendance records:', studentsWithAttendance.map(s => s.roll));
  
  // Check for today's present students
  const presentToday = todayAttendance.map(r => 
    students.find(s => s.roll === r.studentRoll)
  ).filter(Boolean);
  console.log('Present today:', presentToday.map(s => s.roll));
  
  console.log('=== END DEBUG INFO ===');
}

// Enhanced function to force reload and fix attendance data
async function forceReloadAttendanceData() {
  try {
    console.log('Force reloading attendance data...');
    
    // Clear all local data
    attendanceRecords = [];
    localStorage.removeItem('attendanceRecords');
    
    // Reload from Appwrite
    await loadStudentsFromAppwrite();
    await loadAttendanceFromAppwrite();
    
    // Fix any date format issues
    await fixDateFormats();
    
    // Update dashboard
    updateDashboard();
    
    console.log('Force reload completed successfully');
    alert('Attendance data force reloaded successfully!');
    
    // Show debug info
    debugAttendanceData();
    
  } catch (error) {
    console.error('Error during force reload:', error);
    alert('Error during force reload: ' + error.message);
  }
}

// Function to test attendance system with first available student
async function testAttendanceSystem() {
  try {
    const activeStudents = students.filter(s => s.status === 'active');
    if (activeStudents.length === 0) {
      alert('No active students found. Please add a student first.');
      return;
    }
    
    const testStudent = activeStudents[0];
    console.log('Testing attendance system with student:', testStudent.roll);
    
    await addTestAttendance(testStudent.roll);
    
    // Wait a moment and then update dashboard
    setTimeout(() => {
      updateDashboard();
      debugAttendanceData();
    }, 1000);
    
  } catch (error) {
    console.error('Error testing attendance system:', error);
    alert('Error testing attendance system: ' + error.message);
  }
}

// Function to clear all attendance data for testing
async function clearAllAttendanceData() {
  if (!confirm('Are you sure you want to clear ALL attendance data? This action cannot be undone.')) {
    return;
  }
  
  try {
    console.log('Clearing all attendance data...');
    
    // Clear local data
    attendanceRecords = [];
    localStorage.removeItem('attendanceRecords');
    
    // Update dashboard
    updateDashboard();
    
    console.log('All attendance data cleared');
    alert('All attendance data cleared successfully!');
    
  } catch (error) {
    console.error('Error clearing attendance data:', error);
    alert('Error clearing attendance data: ' + error.message);
  }
}

// Function to manually add attendance for testing
async function addTestAttendance(studentRoll) {
  try {
    // Get today's date in local timezone
    const now = new Date();
    const today = now.getFullYear() + '-' + 
                  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(now.getDate()).padStart(2, '0');
    
    const student = students.find(s => s.roll === studentRoll);
    if (!student) {
      console.error('Student not found:', studentRoll);
      return;
    }
    
    // Check if attendance already exists
    const existingRecord = attendanceRecords.find(r => 
      r.studentRoll === studentRoll && r.date === today
    );
    
    if (existingRecord) {
      console.log('Attendance already exists for', studentRoll, 'today');
      return;
    }
    
    const testAttendanceRecord = {
      studentRoll: studentRoll,
      studentId: student.$id,
      date: today,
      timestamp: new Date().toISOString(),
      method: 'test-manual',
      verified: true,
      confidence: '1.000'
    };
    
    const savedRecord = await saveAttendanceToAppwrite(testAttendanceRecord);
    console.log('Test attendance added for', studentRoll, ':', savedRecord);
    
    // Update dashboard
    updateDashboard();
    
  } catch (error) {
    console.error('Error adding test attendance:', error);
  }
}

// Function to fix date format inconsistencies
async function fixDateFormats() {
  try {
    console.log('Fixing date format inconsistencies...');
    
    let fixedCount = 0;
    const now = new Date();
    const today = now.getFullYear() + '-' + 
                  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(now.getDate()).padStart(2, '0');
    
    // Check for records with ISO date format and convert them
    for (let i = 0; i < attendanceRecords.length; i++) {
      const record = attendanceRecords[i];
      
      // If the date is in ISO format (contains T), convert it to local format
      if (record.date && record.date.includes('T')) {
        const isoDate = record.date.split('T')[0];
        const dateObj = new Date(isoDate);
        const localDate = dateObj.getFullYear() + '-' + 
                         String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + 
                         String(dateObj.getDate()).padStart(2, '0');
        
        record.date = localDate;
        fixedCount++;
        console.log(`Fixed date format: ${isoDate} -> ${localDate}`);
      }
    }
    
    if (fixedCount > 0) {
      // Update localStorage
      localStorage.setItem('attendanceRecords', JSON.stringify(attendanceRecords));
      
      // Update dashboard
      updateDashboard();
      
      console.log(`Fixed ${fixedCount} date format inconsistencies`);
      alert(`Fixed ${fixedCount} date format inconsistencies. Dashboard updated.`);
    } else {
      console.log('No date format inconsistencies found');
      alert('No date format inconsistencies found.');
    }
    
  } catch (error) {
    console.error('Error fixing date formats:', error);
    alert('Error fixing date formats: ' + error.message);
  }
}

// Update student dashboard
function updateStudentDashboard() {
  if (!currentUser || currentUserType !== 'student') return;

  const student = currentUser;
  const attendanceData = calculateAttendancePercentage(student.roll);
  const totalDays = getTotalDaysSinceRegistration(student.registeredAt);

  document.getElementById('studentName').textContent = student.name;
  document.getElementById('totalDays').textContent = totalDays;
  document.getElementById('presentDays').textContent = attendanceData.presentDays;
  document.getElementById('attendancePercentage').textContent = attendanceData.percentage + '%';

  updateStudentAttendanceHistory();
}

// Calculate total days since registration
function getTotalDaysSinceRegistration(registeredAt) {
  const regDate = new Date(registeredAt);
  const today = new Date();
  const diffTime = Math.abs(today - regDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Calculate attendance percentage based on unique dates
function calculateAttendancePercentage(studentRoll) {
  // Get all attendance records for this student
  const studentRecords = attendanceRecords.filter(r => r.studentRoll === studentRoll);
  
  // Get unique dates when this student was present
  const uniquePresentDates = [...new Set(studentRecords.map(r => r.date))];
  const presentDays = uniquePresentDates.length;
  
  // Get total unique attendance sessions conducted (all dates in attendance records)
  const allUniqueDates = [...new Set(attendanceRecords.map(r => r.date))];
  const totalSessions = allUniqueDates.length;
  
  // Calculate percentage, ensuring it doesn't exceed 100%
  const percentage = totalSessions > 0 ? Math.min(Math.round((presentDays / totalSessions) * 100), 100) : 0;
  
  return {
    presentDays,
    totalSessions,
    percentage
  };
}

// Update student attendance history
function updateStudentAttendanceHistory() {
  const historyDiv = document.getElementById('studentAttendanceHistory');
  const studentRecords = attendanceRecords
    .filter(r => r.studentRoll === currentUser.roll)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  if (studentRecords.length === 0) {
    historyDiv.innerHTML = '<p>No attendance records found.</p>';
    return;
  }

  historyDiv.innerHTML = studentRecords.map(record => `
    <div class="history-item">
      <strong>${new Date(record.timestamp).toLocaleDateString()}</strong>
      <br>
      <small>${new Date(record.timestamp).toLocaleTimeString()}</small>
      ${record.verified ? ' ✅ Verified' : ' ⚠️ Not Verified'}
    </div>
  `).join('');
}

// Appwrite Database Functions
async function loadConfigFromAppwrite() {
  try {
    const response = await databases.listDocuments(DATABASE_ID, CONFIG_COLLECTION_ID);
    if (response.documents.length > 0) {
      config = response.documents[0];
    } else {
      await databases.createDocument(DATABASE_ID, CONFIG_COLLECTION_ID, ID.unique(), {
        studentAuthEnabled: true
      });
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

async function loadStudentsFromAppwrite() {
  try {
    const response = await databases.listDocuments(DATABASE_ID, STUDENTS_COLLECTION_ID);
    students = response.documents;
  } catch (error) {
    console.error('Error loading students:', error);
  }
}

async function loadAttendanceFromAppwrite() {
  try {
    const response = await databases.listDocuments(DATABASE_ID, ATTENDANCE_COLLECTION_ID);
    attendanceRecords = response.documents;
    console.log('Attendance records loaded from Appwrite:', attendanceRecords.length);
    
    // Sync with localStorage
    localStorage.setItem('attendanceRecords', JSON.stringify(attendanceRecords));
  } catch (error) {
    console.error('Error loading attendance records:', error);
    // Fallback to localStorage if Appwrite fails
    attendanceRecords = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
  }
}

async function syncAttendanceRecords() {
  try {
    // Load from Appwrite first
    const response = await databases.listDocuments(DATABASE_ID, ATTENDANCE_COLLECTION_ID);
    const appwriteRecords = response.documents;
    
    // Load from localStorage
    const localRecords = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
    
    // Merge records, preferring Appwrite data
    const mergedRecords = [...appwriteRecords];
    
    // Add local records that don't exist in Appwrite
    localRecords.forEach(localRecord => {
      const exists = appwriteRecords.some(appwriteRecord => 
        appwriteRecord.studentRoll === localRecord.studentRoll && 
        appwriteRecord.date === localRecord.date
      );
      if (!exists) {
        mergedRecords.push(localRecord);
      }
    });
    
    // Remove duplicates based on studentRoll and date
    const uniqueRecords = mergedRecords.filter((record, index, self) =>
      index === self.findIndex(r => 
        r.studentRoll === record.studentRoll && r.date === record.date
      )
    );
    
    attendanceRecords = uniqueRecords;
    localStorage.setItem('attendanceRecords', JSON.stringify(uniqueRecords));
    
    console.log('Attendance records synced and deduplicated:', uniqueRecords.length);
  } catch (error) {
    console.error('Error syncing attendance records:', error);
    // Fallback to localStorage
    attendanceRecords = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
  }
}

async function saveAttendanceToAppwrite(attendanceData) {
  try {
    console.log('Saving attendance to Appwrite:', attendanceData);
    
    // Validate attendance data
    if (!attendanceData.studentRoll || !attendanceData.date) {
      throw new Error('Invalid attendance data: missing required fields');
    }
    
    // Check for existing attendance for the same student and date
    const existingRecord = attendanceRecords.find(r => 
      r.studentRoll === attendanceData.studentRoll && r.date === attendanceData.date
    );
    
    if (existingRecord) {
      console.log('Attendance already exists for this student and date');
      return existingRecord;
    }
    
    const savedRecord = await databases.createDocument(
      DATABASE_ID,
      ATTENDANCE_COLLECTION_ID,
      ID.unique(),
      attendanceData
    );
    
    // Add the saved record to the local array
    attendanceRecords.push(savedRecord);
    
    // Also save to localStorage as backup
    const localAttendance = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
    localAttendance.push(savedRecord);
    localStorage.setItem('attendanceRecords', JSON.stringify(localAttendance));
    
    console.log('Attendance saved successfully to Appwrite and localStorage:', savedRecord);
    
    // Update dashboard immediately after saving
    updateDashboard();
    
    return savedRecord;
  } catch (error) {
    console.error('Error saving attendance to Appwrite:', error);
    
    // Fallback to localStorage only
    const localAttendance = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
    const localRecord = { ...attendanceData, $id: Date.now().toString() };
    localAttendance.push(localRecord);
    attendanceRecords.push(localRecord);
    localStorage.setItem('attendanceRecords', JSON.stringify(localAttendance));
    
    console.log('Attendance saved to localStorage as fallback');
    
    // Update dashboard immediately after saving
    updateDashboard();
    
    return localRecord;
  }
}

// Toggle student authentication
async function toggleStudentAuth() {
  const newValue = document.getElementById('authToggle').checked;
  try {
    if (config.$id) {
      await databases.updateDocument(DATABASE_ID, CONFIG_COLLECTION_ID, config.$id, {
        studentAuthEnabled: newValue
      });
    }
    config.studentAuthEnabled = newValue;
  } catch (error) {
    console.error('Error updating config:', error);
  }
}

// Show attendance details
function showAttendanceDetails() {
  const detailsDiv = document.getElementById('attendanceDetails');
  
  // Get today's date in local timezone to avoid timezone issues
  const now = new Date();
  const today = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
  
  const todayAttendance = attendanceRecords.filter(r => r.date === today);
  const presentStudents = todayAttendance.map(r => students.find(s => s.roll === r.studentRoll)).filter(Boolean);
  const absentStudents = students.filter(s =>
    s.status === 'active' && !todayAttendance.some(r => r.studentRoll === s.roll)
  );

  document.getElementById('presentList').innerHTML = presentStudents.length > 0
    ? presentStudents.map(s => `
      <div class="student-item">
        <strong>${s.name}</strong> (${s.roll})
      </div>
    `).join('')
    : '<p>No students present today.</p>';

  document.getElementById('absentList').innerHTML = absentStudents.length > 0
    ? absentStudents.map(s => `
      <div class="student-item">
        <strong>${s.name}</strong> (${s.roll})
      </div>
    `).join('')
    : '<p>All students are present!</p>';

  detailsDiv.classList.toggle('hidden');
}

// Show add student modal
function showAddStudentModal() {
  document.getElementById('addStudentModal').style.display = 'block';
}

// Show students list
function showStudentsList() {
  const modal = document.getElementById('studentsListModal');
  const listDiv = document.getElementById('studentsList');
  const activeStudents = students.filter(s => s.status === 'active');

  if (activeStudents.length === 0) {
    listDiv.innerHTML = '<p>No students found.</p>';
  } else {
    listDiv.innerHTML = activeStudents.map(student => `
      <div class="student-card" onclick="showStudentDetail('${student.roll}')">
        ${student.photoUrl ? `<img src="${student.photoUrl}" class="student-photo" alt="${student.name}">` : '👤'}
        <h4>${student.name}</h4>
        <p>Roll: ${student.roll}</p>
      </div>
    `).join('');
  }

  modal.style.display = 'block';
}

// Show student detail
function showStudentDetail(roll) {
  const student = students.find(s => s.roll === roll);
  if (!student) return;

  const studentRecords = attendanceRecords.filter(r => r.studentRoll === roll);
  const totalDays = getTotalDaysSinceRegistration(student.registeredAt);
  const attendanceData = calculateAttendancePercentage(roll);

  const detailContent = document.getElementById('studentDetailContent');
  detailContent.innerHTML = `
    <div style="text-align: center; margin-bottom: 20px;">
      ${student.photoUrl ? `<img src="${student.photoUrl}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover;">` : '<div style="width: 150px; height: 150px; border-radius: 50%; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 48px; margin: 0 auto;">👤</div>'}
      <h3>${student.name}</h3>
      <p>Roll: ${student.roll}</p>
    </div>

    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-number">${totalDays}</div>
        <div class="stat-label">Total Days</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${attendanceData.presentDays}</div>
        <div class="stat-label">Present Days</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${attendanceData.percentage}%</div>
        <div class="stat-label">Attendance</div>
      </div>
    </div>

    <div class="attendance-history">
      <h4>Attendance History</h4>
      ${studentRecords.length > 0
      ? studentRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(record => `
          <div class="history-item">
            <strong>${new Date(record.timestamp).toLocaleDateString()}</strong>
            <br>
            <small>${new Date(record.timestamp).toLocaleTimeString()}</small>
            ${record.verified ? ' ✅ Verified' : ' ⚠️ Not Verified'}
          </div>
        `).join('')
      : '<p>No attendance records found.</p>'
    }
    </div>

    <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
      <button class="btn btn-danger" onclick="deleteStudent('${student.roll}')" style="background: #dc3545;">
        🗑️ Delete Student
      </button>
    </div>
  `;

  document.getElementById('studentDetailModal').style.display = 'block';
}

// File input
function openFileInput() {
  document.getElementById('photoInput').click();
}

// Handle photo upload
function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      currentStudentPhoto = e.target.result;
      document.getElementById('previewImage').src = currentStudentPhoto;
      document.getElementById('photoPreview').classList.remove('hidden');
      document.getElementById('cameraContainer').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }
}

// Open camera for photo capture
function openCamera() {
  const video = document.getElementById('cameraVideo');
  const container = document.getElementById('cameraContainer');

  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
      cameraStream = stream;
      window.cameraStream = stream;
      video.srcObject = stream;
      container.classList.remove('hidden');
      document.getElementById('photoPreview').classList.add('hidden');
    })
    .catch(err => {
      alert('Error accessing camera: ' + err.message);
    });
}

// Capture photo
function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  const context = canvas.getContext('2d');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0);

  currentStudentPhoto = canvas.toDataURL('image/jpeg');
  document.getElementById('previewImage').src = currentStudentPhoto;
  document.getElementById('photoPreview').classList.remove('hidden');

  closeCamera();
}

// Close camera
function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    window.cameraStream = null;
  }
  document.getElementById('cameraContainer').classList.add('hidden');
}

// Remove photo
function removePhoto() {
  currentStudentPhoto = null;
  document.getElementById('photoPreview').classList.add('hidden');
  document.getElementById('photoInput').value = '';
}

// Convert base64 to blob
function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64.split(',')[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

// Enhanced save student with improved photo upload and face recognition
async function saveStudent() {
  const name = document.getElementById('studentNameInput').value.trim();
  const roll = document.getElementById('studentRollInput').value.trim();
  const messageDiv = document.getElementById('addStudentMessage');

  console.log('Save student clicked', { name, roll, hasPhoto: !!currentStudentPhoto });

  if (!name || !roll) {
    messageDiv.innerHTML = '<div class="error-message">Please fill in all required fields!</div>';
    return;
  }

  if (students.some(s => s.roll === roll)) {
    messageDiv.innerHTML = '<div class="error-message">Roll number already exists!</div>';
    return;
  }

  if (!currentStudentPhoto) {
    messageDiv.innerHTML = '<div class="error-message">Please add a student photo!</div>';
    return;
  }

  try {
    messageDiv.innerHTML = '<div class="success-message">Processing student data...</div>';

    let photoUrl = null;
    let faceDescriptor = null;

    // Extract face descriptor if Face-API is loaded
    if (faceApiLoaded && currentStudentPhoto) {
      try {
        messageDiv.innerHTML = '<div class="success-message">Analyzing face features...</div>';
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = currentStudentPhoto;
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          setTimeout(() => reject(new Error('Image load timeout')), 10000);
        });

        const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();
          
        if (detection) {
          faceDescriptor = Array.from(detection.descriptor);
          console.log('Face descriptor extracted successfully:', faceDescriptor.length, 'features');
          messageDiv.innerHTML = '<div class="success-message">Face features extracted! Uploading photo...</div>';
        } else {
          messageDiv.innerHTML = '<div class="error-message">No face detected in the photo. Please ensure a clear face is visible and try again.</div>';
          return;
        }
      } catch (faceError) {
        console.error('Face detection failed:', faceError);
        messageDiv.innerHTML = '<div class="error-message">Face detection failed. Please ensure a clear face is visible and try again.</div>';
        return;
      }
    }

    // Upload photo to Appwrite storage
    try {
      messageDiv.innerHTML = '<div class="success-message">Uploading photo to storage...</div>';
      
      const blob = base64ToBlob(currentStudentPhoto, 'image/jpeg');
      const fileName = `student_${roll}_${Date.now()}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });

      console.log('Uploading file:', fileName, 'Size:', file.size, 'bytes');
      
      const uploadResponse = await storage.createFile(STORAGE_BUCKET_ID, ID.unique(), file);
      console.log('Upload successful:', uploadResponse);
      
      photoUrl = storage.getFileView(STORAGE_BUCKET_ID, uploadResponse.$id);
      console.log('Photo URL generated:', photoUrl);
      
      messageDiv.innerHTML = '<div class="success-message">Photo uploaded! Saving student data...</div>';
    } catch (uploadError) {
      console.error('Photo upload failed:', uploadError);
      messageDiv.innerHTML = '<div class="error-message">Photo upload failed. Please check your Appwrite storage configuration.</div>';
      return;
    }

    // Create student object
    const newStudent = {
      name: name,
      roll: roll,
      photoUrl: photoUrl,
      registeredAt: new Date().toISOString(),
      status: 'active'
    };

    // Add face descriptor if available
   if (faceDescriptor) {
  newStudent.faceDescriptor = JSON.stringify(faceDescriptor);
}


    console.log('Saving student to database:', { ...newStudent, faceDescriptor: faceDescriptor ? 'present' : 'not present' });

    // Save to Appwrite database
    try {
      const savedStudent = await databases.createDocument(
        DATABASE_ID,
        STUDENTS_COLLECTION_ID,
        ID.unique(),
        newStudent
      );

      console.log('Student saved to Appwrite successfully:', savedStudent);
      students.push(savedStudent);
      
      messageDiv.innerHTML = '<div class="success-message">✅ Student added successfully with face recognition!</div>';
      
      // Clear form
      document.getElementById('studentNameInput').value = '';
      document.getElementById('studentRollInput').value = '';
      removePhoto();
      updateDashboard();

      setTimeout(() => {
        document.getElementById('addStudentModal').style.display = 'none';
        messageDiv.innerHTML = '';
      }, 2000);
      
    } catch (dbError) {
      console.error('Database save failed:', dbError);
      messageDiv.innerHTML = '<div class="error-message">Database error: ' + dbError.message + '</div>';
    }

  } catch (error) {
    console.error('Error saving student:', error);
    messageDiv.innerHTML = '<div class="error-message">Error: ' + error.message + '</div>';
  }
}

// Mark attendance
function markAttendance() {
  // Get today's date in local timezone to avoid timezone issues
  const now = new Date();
  const today = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
  
  const existingRecord = attendanceRecords.find(r =>
    r.studentRoll === currentUser.roll && r.date === today
  );

  if (existingRecord) {
    document.getElementById('attendanceStatus').innerHTML =
      '<div class="error-message">You have already marked attendance for today!</div>';
    return;
  }

  document.getElementById('attendanceCameraModal').style.display = 'block';
  openAttendanceCamera();
}

// Open attendance camera
function openAttendanceCamera() {
  const video = document.getElementById('attendanceVideo');

  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
      cameraStream = stream;
      window.cameraStream = stream;
      video.srcObject = stream;
    })
    .catch(err => {
      alert('Error accessing camera: ' + err.message);
    });
}

// Enhanced face matching with improved accuracy and error handling
async function performFaceMatching(capturedImage) {
  if (!faceApiLoaded) {
    console.log('Face-API not loaded, using fallback verification');
    return { success: false, error: 'Face recognition system not available' };
  }

  if (!currentUser.faceDescriptor) {
    console.log('No stored face descriptor for student');
    return { success: false, error: 'No face data available for this student' };
  }

  try {
    console.log('Starting face matching process...');
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = capturedImage;
    
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      setTimeout(() => reject(new Error('Image load timeout')), 5000);
    });

    console.log('Image loaded, detecting face...');
    
    // Try multiple detection methods for better accuracy
    let detection = null;
    
    // First try with TinyFaceDetector
    try {
      detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
    } catch (e) {
      console.log('TinyFaceDetector failed, trying SsdMobilenetv1...');
    }

    // If TinyFaceDetector fails, try SsdMobilenetv1
    if (!detection) {
      try {
        detection = await faceapi.detectSingleFace(img, new faceapi.SsdMobilenetv1Options())
          .withFaceLandmarks()
          .withFaceDescriptor();
      } catch (e) {
        console.log('SsdMobilenetv1 also failed');
      }
    }

    if (!detection) {
      console.log('No face detected in captured image');
      return { success: false, error: 'No face detected in the captured image. Please ensure your face is clearly visible.' };
    }

    console.log('Face detected, comparing descriptors...');
    
    const parsedDescriptor = JSON.parse(currentUser.faceDescriptor);
    const storedDescriptor = new Float32Array(parsedDescriptor);

    const capturedDescriptor = detection.descriptor;

    const distance = faceapi.euclideanDistance(storedDescriptor, capturedDescriptor);
    const threshold = 0.3; // Stricter threshold for better security
    const isMatch = distance < threshold;

    console.log(`Face matching results - Distance: ${distance.toFixed(4)}, Threshold: ${threshold}, Match: ${isMatch}`);
    
    // Additional confidence check
    if (isMatch && distance > 0.3) {
      console.log('Match found but with low confidence, requiring additional verification');
      return { success: false, error: 'Face verification confidence too low. Please try again with better lighting and a clearer view of your face.' };
    }
    
    return { success: isMatch, distance: distance, threshold: threshold };
  } catch (error) {
    console.error('Error in face matching:', error);
    return { success: false, error: 'Face verification failed. Please try again.' };
  }
}

// Enhanced capture attendance with improved face recognition
async function captureAttendance() {
  const video = document.getElementById('attendanceVideo');
  const canvas = document.getElementById('attendanceCanvas');
  const context = canvas.getContext('2d');
  const messageDiv = document.getElementById('attendanceMessage');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0);

  const capturedImage = canvas.toDataURL('image/jpeg');

  try {
    messageDiv.innerHTML = '<div class="success-message">Processing face verification...</div>';

    const faceMatchResult = await performFaceMatching(capturedImage);

    if (faceMatchResult.success) {
      // Get today's date in local timezone to avoid timezone issues
      const now = new Date();
      const today = now.getFullYear() + '-' + 
                    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                    String(now.getDate()).padStart(2, '0');
      
      const attendanceRecord = {
        studentRoll: currentUser.roll,
        studentId: currentUser.$id,
        date: today,
        timestamp: new Date().toISOString(),
        method: 'face-match',
        verified: true,
        confidence: faceMatchResult.distance ? (1 - faceMatchResult.distance).toFixed(3) : null
      };

      const savedRecord = await saveAttendanceToAppwrite(attendanceRecord);

      messageDiv.innerHTML = '<div class="success-message">✅ Attendance marked successfully! Face verified.</div>';

      setTimeout(() => {
        document.getElementById('attendanceCameraModal').style.display = 'none';
        updateStudentDashboard();
        updateDashboard(); // Update admin dashboard as well
        document.getElementById('attendanceStatus').innerHTML =
          '<div class="success-message">✅ Attendance marked for today!</div>';
        
        // Force refresh dashboard data to ensure accuracy
        setTimeout(() => {
          refreshDashboardData();
        }, 500);
      }, 2000);
    } else {
      messageDiv.innerHTML = `<div class="error-message">❌ ${faceMatchResult.error}</div>`;
    }
  } catch (error) {
    console.error('Error during face verification:', error);
    messageDiv.innerHTML = '<div class="error-message">❌ Error during verification. Please try again.</div>';
  } finally {
    // Close camera stream after processing
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
  }
}

// Enhanced logout with proper session cleanup
async function logout() {
  try {
    await account.deleteSession('current').catch(() => {}); // clear existing Appwrite session
  } catch (e) {
    console.warn('Error deleting session:', e);
  }

  // Reset login attempts
  loginAttempts = { admin: 0, lastAttempt: 0, lockoutUntil: 0 };

  currentUser = null;
  currentUserType = null;
  document.getElementById('loginSection').style.display = 'block';
  document.getElementById('adminDashboard').style.display = 'none';
  document.getElementById('studentDashboard').style.display = 'none';

  document.getElementById('adminUsername').value = '';
  document.getElementById('adminPassword').value = '';
  document.getElementById('studentRoll').value = '';
  document.getElementById('loginMessage').innerHTML = '';
}

// Delete student
async function deleteStudent(roll) {
  if (!confirm(`Are you sure you want to delete student with roll number ${roll}? This action cannot be undone.`)) {
    return;
  }

  try {
    const student = students.find(s => s.roll === roll);
    if (!student) {
      alert('Student not found!');
      return;
    }

    // Delete from Appwrite database
    try {
      if (student.$id) {
        await databases.deleteDocument(DATABASE_ID, STUDENTS_COLLECTION_ID, student.$id);
        console.log('Student deleted from Appwrite successfully');
      }
    } catch (error) {
      console.error('Error deleting from Appwrite:', error);
    }

    // Delete photo from storage if exists
    if (student.photoUrl && student.photoUrl.includes('/files/')) {
      try {
        const fileId = student.photoUrl.split('/files/')[1]?.split('/')[0];
        if (fileId) {
          await storage.deleteFile(STORAGE_BUCKET_ID, fileId);
          console.log('Student photo deleted from storage');
        }
      } catch (error) {
        console.error('Error deleting photo from storage:', error);
      }
    }

    students = students.filter(s => s.roll !== roll);
    const localStudents = students.filter(s => s.status === 'active');
    localStorage.setItem('students', JSON.stringify(localStudents));

    // Delete attendance records
    try {
      const studentAttendance = attendanceRecords.filter(r => r.studentRoll === roll);
      for (const record of studentAttendance) {
        if (record.$id) {
          try {
            await databases.deleteDocument(DATABASE_ID, ATTENDANCE_COLLECTION_ID, record.$id);
          } catch (error) {
            console.error('Error deleting attendance record:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error deleting attendance records:', error);
    }

    attendanceRecords = attendanceRecords.filter(r => r.studentRoll !== roll);
    localStorage.setItem('attendanceRecords', JSON.stringify(attendanceRecords));

    document.getElementById('studentDetailModal').style.display = 'none';
    updateDashboard();

    const studentsModal = document.getElementById('studentsListModal');
    if (studentsModal.style.display === 'block') {
      showStudentsList();
    }

    alert(`Student ${roll} has been deleted successfully!`);
  } catch (error) {
    console.error('Error deleting student:', error);
    alert('Error deleting student: ' + error.message);
  }
}

// Initialize on load
window.onload = () => {
  if (typeof faceapi !== 'undefined') {
    init();
  } else {
    setTimeout(() => init(), 1000);
  }
};
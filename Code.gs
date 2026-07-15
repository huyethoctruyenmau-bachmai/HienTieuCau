/**
 * HIẾN TIỂU CẦU BẠCH MAI
 * Backend Google Apps Script
 * Version: 5.3
 *
 * Kiến trúc dữ liệu: 6 sheet, mỗi bản ghi nghiệp vụ là một dòng.
 * Dữ liệu tìm kiếm/lọc giữ ở cột khóa; chi tiết linh hoạt lưu trong DataJson.
 * Các sheet cũ không bị xóa và không được tự động chuyển dữ liệu.
 */

const APP = Object.freeze({
  VERSION: '5.3',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  SESSION_HOURS: 8,
  PUBLIC_SESSION_HOURS: 2,
  OTP_MINUTES: 3,
  OTP_RESEND_SECONDS: 60,
  OTP_MAX_ATTEMPTS: 5,
  MAX_OTP_REQUESTS_PER_HOUR: 6,
  MAX_LIST_ROWS: 500,
  SHEETS: Object.freeze({
    CONFIG: 'CONFIG',
    USERS: 'USERS',
    DONORS: 'DONORS',
    APPOINTMENTS: 'APPOINTMENTS',
    SLOTS: 'SLOTS',
    SYSTEM: 'SYSTEM_DATA'
  })
});

const HEADERS = Object.freeze({
  CONFIG: ['Id', 'Type', 'Status', 'UpdatedAt', 'DataJson'],
  USERS: ['Id', 'Username', 'PasswordHash', 'Role', 'Status', 'UpdatedAt', 'DataJson'],
  DONORS: ['DonorId', 'Phone', 'FullName', 'DateOfBirth', 'Status', 'UpdatedAt', 'DataJson'],
  APPOINTMENTS: ['Id', 'DonorId', 'Phone', 'AppointmentDate', 'SlotId', 'Status', 'CreatedAt', 'UpdatedAt', 'DataJson'],
  SLOTS: ['SlotId', 'Date', 'StartTime', 'EndTime', 'Capacity', 'Booked', 'Status', 'UpdatedAt', 'DataJson'],
  SYSTEM_DATA: ['Id', 'Type', 'RefId', 'Status', 'ExpiresAt', 'CreatedAt', 'DataJson']
});

const ADMIN_ROLES = Object.freeze(['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'SCREENING', 'REPORT_VIEWER']);
const APPOINTMENT_STATUSES = Object.freeze([
  'CONFIRMED', 'CHECKED_IN', 'SCREENING', 'ELIGIBLE', 'IN_PROGRESS',
  'COMPLETED', 'DEFERRED', 'CANCELLED', 'NO_SHOW'
]);

const FIXED_DONATION_SLOTS = Object.freeze([
  Object.freeze({ id: 'SLOT_0700_0900', startTime: '07:00', endTime: '09:00' }),
  Object.freeze({ id: 'SLOT_0900_1100', startTime: '09:00', endTime: '11:00' }),
  Object.freeze({ id: 'SLOT_1100_1300', startTime: '11:00', endTime: '13:00' }),
  Object.freeze({ id: 'SLOT_1300_1500', startTime: '13:00', endTime: '15:00' }),
  Object.freeze({ id: 'SLOT_1500_1600', startTime: '15:00', endTime: '16:00' }),
  Object.freeze({ id: 'SLOT_1600_1700', startTime: '16:00', endTime: '17:00' })
]);

const OCCUPYING_STATUSES = Object.freeze([
  'CONFIRMED', 'CHECKED_IN', 'SCREENING', 'ELIGIBLE', 'IN_PROGRESS', 'COMPLETED'
]);

function doGet() {
  return jsonOutput_({
    ok: true,
    app: 'HIẾN TIỂU CẦU BẠCH MAI',
    version: APP.VERSION,
    message: 'Backend đang hoạt động. Frontend gọi API bằng POST.'
  });
}

function doPost(e) {
  try {
    const body = parseRequestBody_(e);
    const action = String(body.action || '').trim();
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    if (!action) throw appError_('INVALID_ACTION', 'Thiếu action API.');

    const result = route_(action, data);
    return jsonOutput_({ ok: true, version: APP.VERSION, data: result });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    try { logError_(error); } catch (ignored) {}
    return jsonOutput_({
      ok: false,
      version: APP.VERSION,
      error: {
        code: error && error.code ? error.code : 'SERVER_ERROR',
        message: error && error.message ? error.message : 'Có lỗi xảy ra trên hệ thống.'
      }
    });
  }
}

function route_(action, data) {
  switch (action) {
    case 'public_bootstrap': return publicBootstrap_();
    case 'auth_requestOtp': return requestOtp_(data);
    case 'auth_verifyOtp': return verifyOtp_(data);
    case 'donor_getProfile': return getDonorProfile_(data);
    case 'schedule_getSlots': return getAvailableSlots_(data);
    case 'schedule_getConfig': return adminGetScheduleConfig_(data);
    case 'schedule_saveConfig': return adminSaveScheduleConfig_(data);
    case 'registration_create': return createRegistration_(data);
    case 'registration_getDetail': return getRegistrationDetail_(data);
    case 'registration_getRescheduleSlots': return getRescheduleSlots_(data);
    case 'registration_reschedule': return rescheduleRegistration_(data);
    case 'registration_cancel': return cancelRegistration_(data);

    case 'account_login': return adminLogin_(data);
    case 'account_logout': return adminLogout_(data);
    case 'admin_getDashboard': return adminGetDashboard_(data);
    case 'admin_listAppointments': return adminListAppointments_(data);
    case 'admin_updateAppointmentStatus': return adminUpdateAppointmentStatus_(data);
    case 'admin_generateSlots': return adminGenerateSlots_(data);
    case 'admin_checkInByQr': return adminCheckInByQr_(data);
    case 'admin_getReport': return adminGetReport_(data);
    case 'admin_listDonors': return adminListDonors_(data);
    case 'admin_listQuestions': return adminListQuestions_(data);
    case 'admin_updateQuestion': return adminUpdateQuestion_(data);
    case 'admin_listUsers': return adminListUsers_(data);
    case 'admin_listSystemData': return adminListSystemData_(data);
    case 'push_getStatus': return pushGetStatus_(data);
    case 'push_registerDevice': return pushRegisterDevice_(data);
    case 'push_unregisterDevice': return pushUnregisterDevice_(data);
    default: throw appError_('UNKNOWN_ACTION', 'Action không được hỗ trợ: ' + action);
  }
}

/* =========================
 * CÀI ĐẶT HỆ THỐNG
 * ========================= */

function setupApp() {
  const ss = getDb_();
  Object.keys(APP.SHEETS).forEach(function (key) {
    const sheetName = APP.SHEETS[key];
    ensureSheet_(ss, sheetName, HEADERS[sheetName]);
  });

  seedGeneralConfig_();
  seedQuestionnaire_();
  seedGuidelines_();
  seedDonationSchedule_();
  const adminInfo = ensureInitialAdmin_();

  console.log('Thiết lập hoàn tất. Version ' + APP.VERSION);
  console.log('Cấu trúc đang sử dụng: CONFIG, USERS, DONORS, APPOINTMENTS, SLOTS, SYSTEM_DATA.');
  console.log('Lịch đăng ký mới được kiểm tra theo DONATION_SCHEDULE trong CONFIG. Sheet SLOTS được giữ để tương thích dữ liệu cũ.');
  console.log('Các sheet cũ không bị xóa và không được code mới sử dụng trực tiếp.');
  if (adminInfo.created) {
    console.log('Tài khoản quản trị ban đầu: ' + adminInfo.username);
    console.log('Mật khẩu tạm thời: ' + adminInfo.password);
  } else {
    console.log('Tài khoản admin đã tồn tại. Mật khẩu hiện tại được giữ nguyên.');
    console.log('Nếu quên mật khẩu, chọn và chạy hàm resetAdminPassword().');
  }

  return {
    ok: true,
    spreadsheetId: ss.getId(),
    version: APP.VERSION,
    sheets: Object.keys(APP.SHEETS).map(function (key) { return APP.SHEETS[key]; }),
    initialAdmin: adminInfo
  };
}

function setSpreadsheetId(spreadsheetId) {
  const id = String(spreadsheetId || '').trim();
  if (!id) throw new Error('Thiếu Spreadsheet ID.');
  SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  return 'Đã lưu SPREADSHEET_ID.';
}

function setOtpTestMode(enabled) {
  PropertiesService.getScriptProperties().setProperty('OTP_TEST_MODE', enabled ? 'true' : 'false');
  return 'OTP_TEST_MODE=' + (enabled ? 'true' : 'false');
}

function setSmsProvider(apiUrl, apiToken, senderName) {
  PropertiesService.getScriptProperties().setProperties({
    SMS_API_URL: String(apiUrl || '').trim(),
    SMS_API_TOKEN: String(apiToken || '').trim(),
    SMS_SENDER_NAME: String(senderName || 'BACHMAI').trim()
  });
  return 'Đã lưu cấu hình nhà cung cấp SMS. Cần chỉnh sendOtpSms_ theo đúng API nhà cung cấp.';
}

function setTurnstileSecret(secret) {
  PropertiesService.getScriptProperties().setProperty('TURNSTILE_SECRET', String(secret || '').trim());
  return 'Đã lưu TURNSTILE_SECRET.';
}


/**
 * Lưu cấu hình Firebase Cloud Messaging vào Script Properties.
 * Firebase web config và VAPID key không phải bí mật; service-account private key là bí mật.
 * Private key có thể truyền ở dạng chứa ký tự \\n.
 */
function setFirebasePushConfig(apiKey, authDomain, projectId, messagingSenderId, appId, vapidKey, serviceAccountEmail, privateKey, pwaBaseUrl) {
  const props = {
    FIREBASE_API_KEY: String(apiKey || '').trim(),
    FIREBASE_AUTH_DOMAIN: String(authDomain || '').trim(),
    FIREBASE_PROJECT_ID: String(projectId || '').trim(),
    FIREBASE_MESSAGING_SENDER_ID: String(messagingSenderId || '').trim(),
    FIREBASE_APP_ID: String(appId || '').trim(),
    FIREBASE_VAPID_KEY: String(vapidKey || '').trim(),
    FIREBASE_SERVICE_ACCOUNT_EMAIL: String(serviceAccountEmail || '').trim(),
    FIREBASE_PRIVATE_KEY: String(privateKey || '').replace(/\\n/g, '\n').trim(),
    PWA_BASE_URL: String(pwaBaseUrl || '').trim().replace(/\/$/, '')
  };
  const missing = Object.keys(props).filter(function (key) { return !props[key] && key !== 'PWA_BASE_URL'; });
  if (missing.length) throw new Error('Thiếu cấu hình: ' + missing.join(', '));
  PropertiesService.getScriptProperties().setProperties(props, false);
  CacheService.getScriptCache().remove('FCM_ACCESS_TOKEN');
  return 'Đã lưu cấu hình Firebase Push.';
}

function clearFirebasePushConfig() {
  const keys = [
    'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
    'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID', 'FIREBASE_VAPID_KEY',
    'FIREBASE_SERVICE_ACCOUNT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'PWA_BASE_URL'
  ];
  const store = PropertiesService.getScriptProperties();
  keys.forEach(function (key) { store.deleteProperty(key); });
  CacheService.getScriptCache().remove('FCM_ACCESS_TOKEN');
  return 'Đã xóa cấu hình Firebase Push.';
}

function resetAdminPassword(username) {
  const user = findUserByUsername_(username || 'admin');
  if (!user) throw new Error('Không tìm thấy tài khoản.');

  const password = randomReadablePassword_();
  const salt = randomToken_(16);
  const data = Object.assign({}, user.data, { salt: salt });
  updateRowObject_(APP.SHEETS.USERS, user.__row, {
    PasswordHash: hash_(password, salt),
    Status: 'ACTIVE',
    UpdatedAt: nowIso_(),
    DataJson: JSON.stringify(data),
    Salt: salt
  });

  console.log('Tài khoản: ' + user.username);
  console.log('Mật khẩu tạm thời mới: ' + password);
  return { username: user.username, password: password };
}

function changeAdminPassword(username, oldPassword, newPassword) {
  const user = findUserByUsername_(username);
  if (!user || user.status !== 'ACTIVE') throw new Error('Không tìm thấy tài khoản đang hoạt động.');
  if (hash_(oldPassword, user.salt) !== user.passwordHash) throw new Error('Mật khẩu cũ không đúng.');
  validatePassword_(newPassword);

  const salt = randomToken_(16);
  const data = Object.assign({}, user.data, { salt: salt });
  updateRowObject_(APP.SHEETS.USERS, user.__row, {
    PasswordHash: hash_(newPassword, salt),
    UpdatedAt: nowIso_(),
    DataJson: JSON.stringify(data),
    Salt: salt
  });
  return 'Đổi mật khẩu thành công.';
}

/* =========================
 * API NGƯỜI HIẾN
 * ========================= */

function publicBootstrap_() {
  const cfg = getGeneralConfig_();
  const schedule = getDonationSchedule_();
  return {
    app: {
      name: cfg.appName,
      organizationLine1: cfg.organizationLine1,
      organizationLine2: cfg.organizationLine2,
      location: cfg.location,
      supportPhone: cfg.supportPhone,
      workingHours: cfg.workingHours,
      maxBookingDays: Number(cfg.maxBookingDays || 30),
      minBookingHours: Number(cfg.minBookingHours || 2),
      turnstileSiteKey: cfg.turnstileSiteKey || ''
    },
    schedule: publicScheduleView_(schedule),
    push: getFirebasePublicConfig_(),
    questions: listActiveQuestions_(),
    guides: listGuidelines_(),
    serverDate: todayIso_(),
    version: APP.VERSION
  };
}

function requestOtp_(data) {
  const phone = normalizePhone_(data.phone);
  const requestedDate = normalizeIsoDate_(data.date);
  if (!phone) throw appError_('INVALID_PHONE', 'Số điện thoại không hợp lệ.');
  if (!requestedDate) throw appError_('INVALID_DATE', 'Ngày đăng ký không hợp lệ.');

  verifyTurnstile_(data.turnstileToken || '');
  validateBookableDate_(requestedDate);
  enforceOtpRateLimit_(phone);

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const salt = randomToken_(12);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + APP.OTP_MINUTES * 60 * 1000);
  const otpId = 'OTP_' + Utilities.getUuid();

  appendObject_(APP.SHEETS.SYSTEM, {
    Id: otpId,
    Type: 'OTP',
    RefId: phone,
    Status: 'PENDING',
    ExpiresAt: expiresAt.toISOString(),
    CreatedAt: now.toISOString(),
    DataJson: JSON.stringify({
      phone: phone,
      requestedDate: requestedDate,
      otpHash: hash_(otp, salt),
      salt: salt,
      attempts: 0,
      verified: false,
      lastSentAt: now.toISOString()
    })
  });

  sendOtpSms_(phone, otp);
  audit_('PUBLIC', phone, 'REQUEST_OTP', otpId, { requestedDate: requestedDate });

  const response = {
    otpSessionId: otpId,
    expiresInSeconds: APP.OTP_MINUTES * 60,
    resendAfterSeconds: APP.OTP_RESEND_SECONDS
  };
  if (isOtpTestMode_()) response.debugOtp = otp;
  return response;
}

function verifyOtp_(data) {
  const otpSessionId = String(data.otpSessionId || '').trim();
  const otp = String(data.otp || '').trim();
  if (!otpSessionId || !/^\d{6}$/.test(otp)) throw appError_('INVALID_OTP', 'Mã OTP không hợp lệ.');

  const row = findSystemById_(otpSessionId, 'OTP');
  if (!row) throw appError_('OTP_NOT_FOUND', 'Không tìm thấy phiên OTP.');
  if (row.status === 'VERIFIED' || row.data.verified) throw appError_('OTP_USED', 'Mã OTP đã được sử dụng.');
  if (new Date(row.expiresAt).getTime() < Date.now()) throw appError_('OTP_EXPIRED', 'Mã OTP đã hết hiệu lực.');

  const attempts = Number(row.data.attempts || 0);
  if (attempts >= APP.OTP_MAX_ATTEMPTS) throw appError_('OTP_LOCKED', 'Bạn đã nhập sai OTP quá số lần cho phép.');

  if (hash_(otp, row.data.salt) !== row.data.otpHash) {
    row.data.attempts = attempts + 1;
    updateSystemRow_(row, { Status: row.data.attempts >= APP.OTP_MAX_ATTEMPTS ? 'LOCKED' : 'PENDING' }, row.data);
    throw appError_('OTP_INCORRECT', 'Mã OTP không chính xác.');
  }

  const token = randomToken_(32);
  const tokenExpiresAt = new Date(Date.now() + APP.PUBLIC_SESSION_HOURS * 60 * 60 * 1000).toISOString();
  row.data.verified = true;
  row.data.publicTokenHash = sha256_(token);
  row.data.publicTokenExpiresAt = tokenExpiresAt;
  updateSystemRow_(row, { Status: 'VERIFIED' }, row.data);

  audit_('PUBLIC', row.data.phone, 'VERIFY_OTP', otpSessionId, {});
  return {
    token: token,
    expiresAt: tokenExpiresAt,
    phone: maskPhone_(row.data.phone),
    requestedDate: row.data.requestedDate
  };
}

function getDonorProfile_(data) {
  const session = requirePublicSession_(data.token);
  const donor = findDonorByPhone_(session.phone);
  if (!donor) return { exists: false, phone: maskPhone_(session.phone) };

  return {
    exists: true,
    donorId: donor.donorId,
    phone: maskPhone_(donor.phone),
    fullName: donor.fullName,
    birthDate: donor.dateOfBirth,
    gender: donor.data.gender || '',
    bloodGroup: donor.data.bloodGroup || '',
    citizenIdLast4: donor.data.citizenIdLast4 || '',
    province: donor.data.province || '',
    email: donor.data.email || ''
  };
}

function getAvailableSlots_(data) {
  const session = requirePublicSession_(data.token);
  const date = normalizeIsoDate_(data.date);
  if (!date) throw appError_('INVALID_DATE', 'Ngày đăng ký không hợp lệ.');
  if (session.requestedDate && session.requestedDate !== date) {
    throw appError_('DATE_CHANGED', 'Ngày đăng ký đã thay đổi. Vui lòng xác thực lại số điện thoại.');
  }
  validateBookableDate_(date);
  return { date: date, slots: listAvailableSlots_(date) };
}

function createRegistration_(data) {
  const session = requirePublicSession_(data.token);
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
  const fullName = normalizeName_(payload.fullName);
  const birthDate = normalizeIsoDate_(payload.birthDate);
  const gender = String(payload.gender || '').trim().toUpperCase();
  const date = normalizeIsoDate_(payload.date);
  const slotId = String(payload.slotId || '').trim();
  const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};

  if (!fullName) throw appError_('INVALID_NAME', 'Vui lòng nhập họ và tên.');
  if (!birthDate || new Date(birthDate + 'T00:00:00').getTime() >= Date.now()) throw appError_('INVALID_BIRTH_DATE', 'Ngày sinh không hợp lệ.');
  if (!['MALE', 'FEMALE', 'OTHER'].includes(gender)) throw appError_('INVALID_GENDER', 'Giới tính không hợp lệ.');
  if (!date || !slotId) throw appError_('INVALID_SLOT', 'Vui lòng chọn ngày và khung giờ.');
  if (session.requestedDate && session.requestedDate !== date) throw appError_('DATE_CHANGED', 'Ngày đăng ký đã thay đổi. Vui lòng xác thực lại.');

  validateBookableDate_(date);
  validateRequiredAnswers_(answers);
  const risk = evaluateRisk_(answers);
  const cfg = getGeneralConfig_();
  const lock = LockService.getScriptLock();
  let result;
  let pushInfo;

  lock.waitLock(30000);
  try {
    const slot = findConfiguredSlot_(slotId, date);
    validateConfiguredSlotForBooking_(slot, date);

    const duplicate = readAppointmentsNormalized_().find(function (item) {
      return item.phone === session.phone && item.appointmentDate === date && item.status !== 'CANCELLED';
    });
    if (duplicate) throw appError_('DUPLICATE_REGISTRATION', 'Số điện thoại này đã có lịch đăng ký trong ngày đã chọn.');

    const donor = upsertDonor_({
      phone: session.phone,
      fullName: fullName,
      dateOfBirth: birthDate,
      gender: gender,
      citizenIdLast4: sanitizeText_(payload.citizenIdLast4, 4),
      province: sanitizeText_(payload.province, 100),
      email: sanitizeText_(payload.email, 120)
    });

    const appointmentId = 'APT_' + Utilities.getUuid();
    const codeValue = createAppointmentCode_();
    const manageToken = randomToken_(32);
    const checkInToken = randomToken_(24);
    const now = nowIso_();
    const questionForm = getActiveQuestionnaireForm_();
    const detail = {
      code: codeValue,
      fullName: fullName,
      birthDate: birthDate,
      gender: gender,
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotSnapshot: {
        slotId: slot.slotId,
        startTime: slot.startTime,
        endTime: slot.endTime,
        capacityAtBooking: slot.capacity
      },
      riskLevel: risk.level,
      riskQuestionIds: risk.questionIds,
      answers: answers,
      questionnaireVersion: questionForm.version,
      consent: true,
      citizenIdLast4: sanitizeText_(payload.citizenIdLast4, 4),
      province: sanitizeText_(payload.province, 100),
      email: sanitizeText_(payload.email, 120),
      manageTokenHash: sha256_(manageToken),
      checkInTokenHash: sha256_(checkInToken),
      checkInAt: '',
      completedAt: '',
      cancelReason: '',
      notes: '',
      statusHistory: [{ status: 'CONFIRMED', at: now, actor: 'PUBLIC' }]
    };

    appendObject_(APP.SHEETS.APPOINTMENTS, {
      Id: appointmentId,
      DonorId: donor.donorId,
      Phone: session.phone,
      AppointmentDate: date,
      SlotId: slot.slotId,
      Status: 'CONFIRMED',
      CreatedAt: now,
      UpdatedAt: now,
      DataJson: JSON.stringify(detail)
    });

    audit_('PUBLIC', session.phone, 'CREATE_REGISTRATION', appointmentId, { date: date, slotId: slot.slotId, riskLevel: risk.level });
    queueNotification_(appointmentId, session.phone, 'SMS', 'REGISTRATION_CONFIRMED');

    result = {
      appointmentId: appointmentId,
      code: codeValue,
      manageToken: manageToken,
      qrText: 'BMTC|' + codeValue + '|' + checkInToken,
      fullName: fullName,
      date: date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      location: cfg.location,
      riskLevel: risk.level,
      message: 'Lịch đăng ký đã được ghi nhận. Vui lòng lưu mã QR để xuất trình khi đến.'
    };
    pushInfo = { appointmentId: appointmentId, date: date, startTime: slot.startTime, endTime: slot.endTime };
  } finally {
    lock.releaseLock();
  }

  try { sendNewRegistrationPush_(pushInfo); } catch (pushError) { logError_(pushError); }
  return result;
}

function getRegistrationDetail_(data) {
  const appointment = requireManageAccess_(data.code, data.manageToken);
  return publicAppointmentView_(appointment);
}

function getRescheduleSlots_(data) {
  requireManageAccess_(data.code, data.manageToken);
  const date = normalizeIsoDate_(data.date);
  if (!date) throw appError_('INVALID_DATE', 'Ngày mới không hợp lệ.');
  validateBookableDate_(date);
  return { date: date, slots: listAvailableSlots_(date) };
}

function rescheduleRegistration_(data) {
  const codeValue = String(data.code || '').trim().toUpperCase();
  const manageToken = String(data.manageToken || '').trim();
  const newDate = normalizeIsoDate_(data.date);
  const newSlotId = String(data.slotId || '').trim();
  if (!newDate || !newSlotId) throw appError_('INVALID_SLOT', 'Vui lòng chọn ngày và khung giờ mới.');
  validateBookableDate_(newDate);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const appointment = requireManageAccess_(codeValue, manageToken);
    if (!['CONFIRMED'].includes(appointment.status)) {
      throw appError_('CANNOT_RESCHEDULE', 'Lịch này không còn ở trạng thái cho phép đổi lịch.');
    }

    const newSlot = findConfiguredSlot_(newSlotId, newDate);
    if (appointment.appointmentDate === newDate && appointment.slotId === newSlotId) {
      return publicAppointmentView_(appointment);
    }
    validateConfiguredSlotForBooking_(newSlot, newDate, appointment.id);

    const duplicate = readAppointmentsNormalized_().find(function (item) {
      return item.id !== appointment.id && item.phone === appointment.phone && item.appointmentDate === newDate && item.status !== 'CANCELLED';
    });
    if (duplicate) throw appError_('DUPLICATE_REGISTRATION', 'Bạn đã có một lịch khác trong ngày đã chọn.');

    const now = nowIso_();
    const detail = Object.assign({}, appointment.data, {
      startTime: newSlot.startTime,
      endTime: newSlot.endTime,
      slotSnapshot: {
        slotId: newSlot.slotId,
        startTime: newSlot.startTime,
        endTime: newSlot.endTime,
        capacityAtBooking: newSlot.capacity
      },
      statusHistory: (appointment.data.statusHistory || []).concat([{
        status: appointment.status,
        at: now,
        actor: 'PUBLIC',
        action: 'RESCHEDULE',
        fromDate: appointment.appointmentDate,
        fromSlotId: appointment.slotId,
        toDate: newDate,
        toSlotId: newSlotId
      }])
    });

    updateRowObject_(APP.SHEETS.APPOINTMENTS, appointment.__row, {
      Id: appointment.id,
      AppointmentDate: newDate,
      SlotId: newSlotId,
      UpdatedAt: now,
      DataJson: JSON.stringify(detail),
      Date: newDate,
      StartTime: newSlot.startTime,
      EndTime: newSlot.endTime
    });

    audit_('PUBLIC', appointment.phone, 'RESCHEDULE_REGISTRATION', appointment.id, { date: newDate, slotId: newSlotId });
    queueNotification_(appointment.id, appointment.phone, 'SMS', 'REGISTRATION_RESCHEDULED');
    return publicAppointmentView_(findAppointmentById_(appointment.id));
  } finally {
    lock.releaseLock();
  }
}

function cancelRegistration_(data) {
  const code = String(data.code || '').trim().toUpperCase();
  const manageToken = String(data.manageToken || '').trim();
  const reason = sanitizeText_(data.reason, 300);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const appointment = requireManageAccess_(code, manageToken);
    if (appointment.status === 'CANCELLED') return publicAppointmentView_(appointment);
    if (!['CONFIRMED'].includes(appointment.status)) {
      throw appError_('CANNOT_CANCEL', 'Lịch này không còn ở trạng thái cho phép hủy trực tuyến.');
    }
    if (parseLocalDateTime_(appointment.appointmentDate, appointment.startTime).getTime() <= Date.now()) {
      throw appError_('CANNOT_CANCEL', 'Đã quá thời gian cho phép hủy trực tuyến. Vui lòng liên hệ đơn vị tiếp nhận.');
    }


    const now = nowIso_();
    const detail = Object.assign({}, appointment.data, {
      cancelReason: reason,
      statusHistory: (appointment.data.statusHistory || []).concat([{ status: 'CANCELLED', at: now, actor: 'PUBLIC' }])
    });
    updateRowObject_(APP.SHEETS.APPOINTMENTS, appointment.__row, {
      Status: 'CANCELLED',
      UpdatedAt: now,
      DataJson: JSON.stringify(detail)
    });

    audit_('PUBLIC', appointment.phone, 'CANCEL_REGISTRATION', appointment.id, { reason: reason });
    queueNotification_(appointment.id, appointment.phone, 'SMS', 'REGISTRATION_CANCELLED');
    return publicAppointmentView_(findAppointmentById_(appointment.id));
  } finally {
    lock.releaseLock();
  }
}

/* =========================
 * API NHÂN VIÊN
 * ========================= */

function adminLogin_(data) {
  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '');
  if (!username || !password) throw appError_('INVALID_LOGIN', 'Vui lòng nhập tài khoản và mật khẩu.');

  const user = findUserByUsername_(username);
  if (!user || user.status !== 'ACTIVE' || hash_(password, user.salt) !== user.passwordHash) {
    throw appError_('INVALID_LOGIN', 'Tài khoản hoặc mật khẩu không đúng.');
  }

  const token = randomToken_(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + APP.SESSION_HOURS * 60 * 60 * 1000).toISOString();
  appendObject_(APP.SHEETS.SYSTEM, {
    Id: 'SES_' + Utilities.getUuid(),
    Type: 'SESSION',
    RefId: user.id,
    Status: 'ACTIVE',
    ExpiresAt: expiresAt,
    CreatedAt: now.toISOString(),
    DataJson: JSON.stringify({
      tokenHash: sha256_(token),
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName
    })
  });

  audit_('USER', user.id, 'LOGIN', user.id, {});
  return {
    token: token,
    expiresAt: expiresAt,
    user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role }
  };
}

function adminLogout_(data) {
  const session = requireAdmin_(data.token, ADMIN_ROLES);
  updateRowObject_(APP.SHEETS.SYSTEM, session.__row, { Status: 'REVOKED' });
  audit_('USER', session.userId, 'LOGOUT', session.userId, {});
  return { success: true };
}

function adminGetDashboard_(data) {
  requireAdmin_(data.token, ADMIN_ROLES);
  const date = normalizeIsoDate_(data.date) || todayIso_();
  const appointments = readAppointmentsNormalized_().filter(function (item) { return item.appointmentDate === date; });
  const byStatus = {};
  appointments.forEach(function (item) { byStatus[item.status] = (byStatus[item.status] || 0) + 1; });

  let slots = [];
  try {
    validateScheduleDateOnly_(date);
    slots = getDonationSchedule_().slots.filter(function (slot) { return slot.capacity > 0; });
  } catch (ignored) {}

  const occupiedAppointments = appointments.filter(function (item) { return OCCUPYING_STATUSES.indexOf(item.status) !== -1; });
  const capacity = slots.reduce(function (sum, slot) { return sum + Number(slot.capacity || 0); }, 0);
  const booked = slots.reduce(function (sum, slot) { return sum + countBookedForConfiguredSlot_(date, slot, '', occupiedAppointments); }, 0);
  return {
    date: date,
    total: appointments.length,
    byStatus: byStatus,
    capacity: capacity,
    booked: booked,
    remaining: slots.reduce(function (sum, slot) {
      return sum + Math.max(0, Number(slot.capacity || 0) - countBookedForConfiguredSlot_(date, slot, '', occupiedAppointments));
    }, 0)
  };
}

function adminListAppointments_(data) {
  const session = requireAdmin_(data.token, ADMIN_ROLES);
  const fromDate = normalizeIsoDate_(data.fromDate) || todayIso_();
  const toDate = normalizeIsoDate_(data.toDate) || fromDate;
  const status = String(data.status || '').trim().toUpperCase();
  const keyword = String(data.keyword || '').trim().toLowerCase();
  if (fromDate > toDate) throw appError_('INVALID_RANGE', 'Khoảng ngày không hợp lệ.');

  const items = readAppointmentsNormalized_().filter(function (item) {
    if (item.appointmentDate < fromDate || item.appointmentDate > toDate) return false;
    if (status && item.status !== status) return false;
    if (keyword) {
      const haystack = [item.code, item.fullName, item.phone].join(' ').toLowerCase();
      if (haystack.indexOf(keyword) === -1) return false;
    }
    return true;
  }).sort(function (a, b) {
    return (a.appointmentDate + ' ' + a.startTime).localeCompare(b.appointmentDate + ' ' + b.startTime);
  }).slice(0, APP.MAX_LIST_ROWS);

  return {
    items: items.map(function (item) {
      return adminAppointmentView_(item, session.role);
    })
  };
}

function adminUpdateAppointmentStatus_(data) {
  const session = requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'SCREENING']);
  const appointmentId = String(data.appointmentId || '').trim();
  const newStatus = String(data.status || '').trim().toUpperCase();
  const notes = sanitizeText_(data.notes, 1000);
  if (!APPOINTMENT_STATUSES.includes(newStatus)) throw appError_('INVALID_STATUS', 'Trạng thái không hợp lệ.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const appointment = findAppointmentById_(appointmentId);
    if (!appointment) throw appError_('NOT_FOUND', 'Không tìm thấy lịch đăng ký.');

    const now = nowIso_();
    const detail = Object.assign({}, appointment.data, {
      notes: notes || appointment.notes,
      checkInAt: newStatus === 'CHECKED_IN' && !appointment.checkInAt ? now : appointment.checkInAt,
      completedAt: newStatus === 'COMPLETED' && !appointment.completedAt ? now : appointment.completedAt,
      statusHistory: (appointment.data.statusHistory || []).concat([{ status: newStatus, at: now, actor: session.userId }])
    });

    updateRowObject_(APP.SHEETS.APPOINTMENTS, appointment.__row, {
      Status: newStatus,
      UpdatedAt: now,
      DataJson: JSON.stringify(detail),
      CheckInAt: detail.checkInAt,
      CompletedAt: detail.completedAt,
      Notes: detail.notes
    });

    audit_('USER', session.userId, 'UPDATE_APPOINTMENT_STATUS', appointment.id, { from: appointment.status, to: newStatus });
    return adminAppointmentView_(findAppointmentById_(appointment.id), session.role);
  } finally {
    lock.releaseLock();
  }
}

function adminGetScheduleConfig_(data) {
  requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN']);
  return { schedule: publicScheduleView_(getDonationSchedule_()) };
}

function adminSaveScheduleConfig_(data) {
  const session = requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN']);
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : data;
  const schedule = normalizeDonationSchedulePayload_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const current = findConfigRecord_('CFG_DONATION_SCHEDULE', 'DONATION_SCHEDULE');
    const stored = Object.assign({}, schedule, {
      timezone: APP.TIMEZONE,
      updatedBy: session.userId,
      updatedAt: nowIso_()
    });
    if (current) {
      updateRowObject_(APP.SHEETS.CONFIG, current.__row, {
        Status: 'ACTIVE',
        UpdatedAt: nowIso_(),
        DataJson: JSON.stringify(stored)
      });
    } else {
      appendConfigRecord_('CFG_DONATION_SCHEDULE', 'DONATION_SCHEDULE', 'ACTIVE', stored);
    }
    audit_('USER', session.userId, 'SAVE_DONATION_SCHEDULE', 'CFG_DONATION_SCHEDULE', {
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      excludedDates: schedule.excludedDates.length
    });
    return { schedule: publicScheduleView_(stored) };
  } finally {
    lock.releaseLock();
  }
}

function adminGenerateSlots_(data) {
  const session = requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN']);
  const fromDate = normalizeIsoDate_(data.fromDate);
  const toDate = normalizeIsoDate_(data.toDate);
  const startTime = normalizeTime_(data.startTime);
  const endTime = normalizeTime_(data.endTime);
  const intervalMinutes = Number(data.intervalMinutes || 60);
  const capacity = Number(data.capacity || 4);
  const includeWeekends = toBool_(data.includeWeekends);

  if (!fromDate || !toDate || fromDate > toDate) throw appError_('INVALID_RANGE', 'Khoảng ngày không hợp lệ.');
  if (!startTime || !endTime || timeToMinutes_(startTime) >= timeToMinutes_(endTime)) throw appError_('INVALID_TIME', 'Khoảng giờ không hợp lệ.');
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 240) throw appError_('INVALID_INTERVAL', 'Số phút mỗi khung không hợp lệ.');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw appError_('INVALID_CAPACITY', 'Số người mỗi khung không hợp lệ.');

  const created = generateSlotsRange_(fromDate, toDate, startTime, endTime, intervalMinutes, capacity, includeWeekends);
  audit_('USER', session.userId, 'GENERATE_SLOTS', '', { fromDate: fromDate, toDate: toDate, created: created });
  return { created: created };
}

function adminCheckInByQr_(data) {
  const session = requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'SCREENING']);
  const input = String(data.qrText || data.code || '').trim();
  if (!input) throw appError_('INVALID_QR', 'Vui lòng nhập hoặc quét mã QR.');

  let code = input.toUpperCase();
  let checkInToken = '';
  if (input.indexOf('BMTC|') === 0) {
    const parts = input.split('|');
    code = String(parts[1] || '').toUpperCase();
    checkInToken = String(parts[2] || '');
  }

  const appointment = findAppointmentByCode_(code);
  if (!appointment) throw appError_('NOT_FOUND', 'Không tìm thấy lịch đăng ký.');
  if (checkInToken && sha256_(checkInToken) !== appointment.checkInTokenHash) throw appError_('INVALID_QR', 'Mã QR không hợp lệ.');
  if (appointment.status === 'CANCELLED') throw appError_('CANCELLED', 'Lịch đăng ký đã bị hủy.');

  if (appointment.status !== 'CHECKED_IN') {
    return adminUpdateAppointmentStatus_({
      token: data.token,
      appointmentId: appointment.id,
      status: 'CHECKED_IN',
      notes: ''
    });
  }

  audit_('USER', session.userId, 'SCAN_CHECKIN_QR', appointment.id, { alreadyCheckedIn: true });
  return adminAppointmentView_(appointment, session.role);
}

function adminGetReport_(data) {
  requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN', 'REPORT_VIEWER']);
  const fromDate = normalizeIsoDate_(data.fromDate) || todayIso_();
  const toDate = normalizeIsoDate_(data.toDate) || fromDate;
  if (fromDate > toDate) throw appError_('INVALID_RANGE', 'Khoảng ngày không hợp lệ.');

  const items = readAppointmentsNormalized_().filter(function (item) {
    return item.appointmentDate >= fromDate && item.appointmentDate <= toDate;
  });
  const byStatus = {};
  const dailyMap = {};
  items.forEach(function (item) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    if (!dailyMap[item.appointmentDate]) dailyMap[item.appointmentDate] = { date: item.appointmentDate, total: 0, completed: 0, cancelled: 0, noShow: 0 };
    dailyMap[item.appointmentDate].total += 1;
    if (item.status === 'COMPLETED') dailyMap[item.appointmentDate].completed += 1;
    if (item.status === 'CANCELLED') dailyMap[item.appointmentDate].cancelled += 1;
    if (item.status === 'NO_SHOW') dailyMap[item.appointmentDate].noShow += 1;
  });

  return {
    fromDate: fromDate,
    toDate: toDate,
    total: items.length,
    byStatus: byStatus,
    daily: Object.keys(dailyMap).sort().map(function (key) { return dailyMap[key]; }),
    rows: items.slice(0, APP.MAX_LIST_ROWS).map(function (item) {
      return {
        code: item.code,
        fullName: item.fullName,
        phone: item.phone,
        date: item.appointmentDate,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status,
        riskLevel: item.riskLevel,
        createdAt: item.createdAt
      };
    })
  };
}

function adminListDonors_(data) {
  const session = requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'SCREENING']);
  const keyword = String(data.keyword || '').trim().toLowerCase();
  const items = readDonorsNormalized_().filter(function (item) {
    if (!keyword) return true;
    return [item.fullName, item.phone, item.donorId].join(' ').toLowerCase().indexOf(keyword) !== -1;
  }).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); }).slice(0, 200);

  return {
    items: items.map(function (item) {
      return {
        donorId: item.donorId,
        phone: canViewFullPhone_(session.role) ? item.phone : maskPhone_(item.phone),
        fullName: item.fullName,
        dateOfBirth: item.dateOfBirth,
        gender: item.data.gender || '',
        bloodGroup: item.data.bloodGroup || '',
        province: item.data.province || '',
        status: item.status,
        updatedAt: item.updatedAt
      };
    })
  };
}

function adminListQuestions_(data) {
  requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN', 'SCREENING']);
  return { items: listQuestions_(false) };
}

function adminUpdateQuestion_(data) {
  const session = requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN']);
  const questionId = String(data.questionId || '').trim();
  const row = findConfigRecord_(questionId, 'SCREENING_QUESTION');
  if (!row) throw appError_('NOT_FOUND', 'Không tìm thấy câu hỏi.');

  const detail = Object.assign({}, row.data);
  if (data.text !== undefined) detail.text = sanitizeText_(data.text, 1000);
  if (data.group !== undefined) detail.group = sanitizeText_(data.group, 200);
  if (data.required !== undefined) detail.required = toBool_(data.required);
  if (data.flagAnswer !== undefined) detail.flagAnswer = String(data.flagAnswer || '').trim();
  if (data.flagLevel !== undefined) detail.flagLevel = String(data.flagLevel || 'REVIEW').trim().toUpperCase();
  if (data.sortOrder !== undefined) detail.sortOrder = Number(data.sortOrder || 0);
  const status = data.active === undefined ? row.status : (toBool_(data.active) ? 'ACTIVE' : 'INACTIVE');

  updateRowObject_(APP.SHEETS.CONFIG, row.__row, {
    Status: status,
    UpdatedAt: nowIso_(),
    DataJson: JSON.stringify(detail)
  });
  audit_('USER', session.userId, 'UPDATE_QUESTION', questionId, { status: status });
  return { item: listQuestions_(false).find(function (item) { return item.id === questionId; }) };
}

function adminListUsers_(data) {
  requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN']);
  return {
    items: readUsersNormalized_().map(function (user) {
      return { id: user.id, username: user.username, fullName: user.fullName, role: user.role, status: user.status, updatedAt: user.updatedAt };
    })
  };
}

function adminListSystemData_(data) {
  requireAdmin_(data.token, ['SUPER_ADMIN', 'ADMIN']);
  const type = String(data.type || 'AUDIT').trim().toUpperCase();
  if (!['AUDIT', 'NOTIFICATION', 'ERROR_LOG'].includes(type)) throw appError_('INVALID_TYPE', 'Loại dữ liệu hệ thống không hợp lệ.');

  const items = readSystemNormalized_().filter(function (item) { return item.type === type; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, 200)
    .map(function (item) {
      return { id: item.id, type: item.type, refId: item.refId, status: item.status, createdAt: item.createdAt, data: item.data };
    });
  return { items: items };
}

/* =========================
 * NGHIỆP VỤ CÂU HỎI / NGƯỜI HIẾN / LỊCH
 * ========================= */

function listActiveQuestions_() {
  return listQuestions_(true).map(function (item) {
    return {
      id: item.id,
      group: item.group,
      text: item.text,
      type: item.type,
      required: item.required,
      options: item.options,
      flagAnswer: item.flagAnswer,
      flagLevel: item.flagLevel,
      sortOrder: item.sortOrder
    };
  });
}

function listQuestions_(activeOnly) {
  return readConfigRecords_('SCREENING_QUESTION').filter(function (row) {
    return !activeOnly || row.status === 'ACTIVE';
  }).map(function (row) {
    return {
      id: row.id,
      group: row.data.group || 'Khai báo chung',
      text: row.data.text || '',
      type: row.data.type || 'YES_NO',
      required: row.data.required !== false,
      options: Array.isArray(row.data.options) ? row.data.options : [],
      flagAnswer: row.data.flagAnswer || '',
      flagLevel: row.data.flagLevel || 'REVIEW',
      sortOrder: Number(row.data.sortOrder || 0),
      active: row.status === 'ACTIVE',
      updatedAt: row.updatedAt
    };
  }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
}

function validateRequiredAnswers_(answers) {
  const missing = listActiveQuestions_().filter(function (q) {
    return q.required && (answers[q.id] === undefined || answers[q.id] === null || String(answers[q.id]).trim() === '');
  });
  if (missing.length) throw appError_('MISSING_ANSWERS', 'Vui lòng trả lời đầy đủ các câu hỏi sức khỏe bắt buộc.');
}

function evaluateRisk_(answers) {
  const flagged = [];
  let level = 'NONE';
  const rank = { NONE: 0, REVIEW: 1, HIGH: 2 };
  listActiveQuestions_().forEach(function (q) {
    if (!q.flagAnswer) return;
    if (String(answers[q.id]).toUpperCase() === String(q.flagAnswer).toUpperCase()) {
      flagged.push(q.id);
      const candidate = String(q.flagLevel || 'REVIEW').toUpperCase();
      if ((rank[candidate] || 1) > (rank[level] || 0)) level = candidate;
    }
  });
  return { level: level, questionIds: flagged };
}

function getActiveQuestionnaireForm_() {
  const rows = readConfigRecords_('SCREENING_FORM').filter(function (row) { return row.status === 'ACTIVE'; });
  return rows.length ? rows[0].data : { version: 'MẪU-1' };
}

function upsertDonor_(input) {
  const existing = findDonorByPhone_(input.phone);
  const now = nowIso_();
  if (existing) {
    const detail = Object.assign({}, existing.data, {
      gender: input.gender,
      citizenIdLast4: input.citizenIdLast4,
      province: input.province,
      email: input.email,
      lastRegistrationAt: now
    });
    updateRowObject_(APP.SHEETS.DONORS, existing.__row, {
      DonorId: existing.donorId,
      Phone: input.phone,
      FullName: input.fullName,
      DateOfBirth: input.dateOfBirth,
      Status: 'ACTIVE',
      UpdatedAt: now,
      DataJson: JSON.stringify(detail),
      BirthDate: input.dateOfBirth,
      Gender: input.gender,
      CitizenIdLast4: input.citizenIdLast4,
      Province: input.province,
      Email: input.email
    });
    return findDonorByPhone_(input.phone);
  }

  const donorId = 'DNR_' + Utilities.getUuid();
  appendObject_(APP.SHEETS.DONORS, {
    DonorId: donorId,
    Phone: input.phone,
    FullName: input.fullName,
    DateOfBirth: input.dateOfBirth,
    Status: 'ACTIVE',
    UpdatedAt: now,
    DataJson: JSON.stringify({
      gender: input.gender,
      bloodGroup: '',
      citizenIdLast4: input.citizenIdLast4,
      province: input.province,
      email: input.email,
      createdAt: now,
      lastRegistrationAt: now
    }),
    BirthDate: input.dateOfBirth,
    Gender: input.gender,
    CitizenIdLast4: input.citizenIdLast4,
    Province: input.province,
    Email: input.email,
    CreatedAt: now
  });
  return findDonorByPhone_(input.phone);
}

function publicAppointmentView_(item) {
  return {
    appointmentId: item.id,
    code: item.code,
    fullName: item.fullName,
    phone: maskPhone_(item.phone),
    date: item.appointmentDate,
    slotId: item.slotId,
    startTime: item.startTime,
    endTime: item.endTime,
    status: item.status,
    riskLevel: item.riskLevel,
    location: getGeneralConfig_().location,
    createdAt: item.createdAt,
    cancelReason: item.cancelReason || ''
  };
}

function adminAppointmentView_(item, role) {
  return {
    appointmentId: item.id,
    code: item.code,
    donorId: item.donorId,
    phone: canViewFullPhone_(role) ? item.phone : maskPhone_(item.phone),
    fullName: item.fullName,
    birthDate: item.birthDate,
    gender: item.gender,
    date: item.appointmentDate,
    slotId: item.slotId,
    startTime: item.startTime,
    endTime: item.endTime,
    status: item.status,
    riskLevel: item.riskLevel,
    answers: ['SUPER_ADMIN', 'ADMIN', 'SCREENING'].includes(role) ? item.answers : {},
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    checkInAt: item.checkInAt,
    completedAt: item.completedAt
  };
}

function listAvailableSlots_(date) {
  validateBookableDate_(date);
  const schedule = getDonationSchedule_();
  const appointments = readAppointmentsNormalized_();
  return schedule.slots.filter(function (slot) { return Number(slot.capacity || 0) > 0; })
    .map(function (slot) {
      const booked = countBookedForConfiguredSlot_(date, slot, '', appointments);
      const remaining = Math.max(0, Number(slot.capacity || 0) - booked);
      const tooSoon = isTooSoonSlot_(date, slot.startTime);
      return {
        slotId: slot.id,
        date: date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        capacity: Number(slot.capacity || 0),
        booked: booked,
        remaining: remaining,
        available: remaining > 0 && !tooSoon,
        reason: tooSoon ? 'PAST_OR_TOO_SOON' : (remaining <= 0 ? 'FULL' : '')
      };
    });
}

function validateScheduleDateOnly_(date) {
  const schedule = getDonationSchedule_();
  if (date < schedule.startDate || date > schedule.endDate) {
    throw appError_('DATE_NOT_CONFIGURED', 'Ngày này không nằm trong thời gian tổ chức hiến tiểu cầu.');
  }
  if (schedule.excludedDates.indexOf(date) !== -1) {
    throw appError_('DATE_EXCLUDED', 'Ngày này không tổ chức hiến tiểu cầu. Vui lòng chọn ngày khác.');
  }
  return schedule;
}

function validateBookableDate_(date) {
  if (date < todayIso_()) throw appError_('DATE_IN_PAST', 'Không thể đăng ký ngày đã qua.');
  validateScheduleDateOnly_(date);
}

function findConfiguredSlot_(slotId, date) {
  validateBookableDate_(date);
  const schedule = getDonationSchedule_();
  const slot = schedule.slots.find(function (item) { return item.id === String(slotId || '').trim(); });
  if (!slot || Number(slot.capacity || 0) <= 0) return null;
  return {
    slotId: slot.id,
    id: slot.id,
    date: date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    capacity: Number(slot.capacity || 0)
  };
}

function countBookedForConfiguredSlot_(date, slot, excludeAppointmentId, appointments) {
  const source = Array.isArray(appointments) ? appointments : readAppointmentsNormalized_();
  return source.filter(function (item) {
    if (excludeAppointmentId && item.id === excludeAppointmentId) return false;
    if (item.appointmentDate !== date || OCCUPYING_STATUSES.indexOf(item.status) === -1) return false;
    if (item.slotId === slot.id || item.slotId === slot.slotId) return true;
    return item.startTime === slot.startTime && item.endTime === slot.endTime;
  }).length;
}

function validateConfiguredSlotForBooking_(slot, expectedDate, excludeAppointmentId) {
  if (!slot || slot.date !== expectedDate) throw appError_('SLOT_NOT_FOUND', 'Khung giờ không còn khả dụng.');
  if (isTooSoonSlot_(slot.date, slot.startTime)) throw appError_('SLOT_PAST', 'Khung giờ đã qua hoặc quá gần thời điểm hiện tại.');
  const booked = countBookedForConfiguredSlot_(expectedDate, slot, excludeAppointmentId);
  if (booked >= slot.capacity) throw appError_('SLOT_FULL', 'Khung giờ vừa hết chỗ. Vui lòng chọn khung giờ khác.');
}

function validateSlotForBooking_(slot, expectedDate) {
  if (slot && String(slot.slotId || '').indexOf('SLOT_') === 0) {
    return validateConfiguredSlotForBooking_(slot, expectedDate);
  }
  if (!slot || slot.date !== expectedDate || slot.status !== 'ACTIVE') throw appError_('SLOT_NOT_FOUND', 'Khung giờ không còn khả dụng.');
  if (isTooSoonSlot_(slot.date, slot.startTime)) throw appError_('SLOT_PAST', 'Khung giờ đã qua hoặc quá gần thời điểm hiện tại.');
  if (slot.booked >= slot.capacity) throw appError_('SLOT_FULL', 'Khung giờ vừa hết chỗ. Vui lòng chọn khung giờ khác.');
}

function isTooSoonSlot_(date, startTime) {
  const minHours = Number(getGeneralConfig_().minBookingHours || 2);
  return parseLocalDateTime_(date, startTime).getTime() <= Date.now() + minHours * 60 * 60 * 1000;
}

function createAppointmentCode_() {
  const prefix = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyMMdd');
  for (let i = 0; i < 10; i += 1) {
    const code = 'TC' + prefix + String(Math.floor(1000 + Math.random() * 9000));
    if (!findAppointmentByCode_(code)) return code;
  }
  return 'TC' + prefix + String(Date.now()).slice(-6);
}

/* =========================
 * OTP, SMS, CAPTCHA, PHIÊN
 * ========================= */

function isOtpTestMode_() {
  return PropertiesService.getScriptProperties().getProperty('OTP_TEST_MODE') !== 'false';
}

function enforceOtpRateLimit_(phone) {
  const since = Date.now() - 60 * 60 * 1000;
  const count = readSystemNormalized_().filter(function (item) {
    return item.type === 'OTP' && item.refId === phone && new Date(item.createdAt).getTime() >= since;
  }).length;
  if (count >= APP.MAX_OTP_REQUESTS_PER_HOUR) throw appError_('OTP_RATE_LIMIT', 'Bạn đã yêu cầu OTP quá nhiều lần. Vui lòng thử lại sau.');

  const latest = readSystemNormalized_().filter(function (item) {
    return item.type === 'OTP' && item.refId === phone;
  }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })[0];
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < APP.OTP_RESEND_SECONDS * 1000) {
    throw appError_('OTP_TOO_SOON', 'Vui lòng chờ trước khi yêu cầu gửi lại OTP.');
  }
}

function sendOtpSms_(phone, otp) {
  if (isOtpTestMode_()) {
    console.log('OTP thử nghiệm cho ' + phone + ': ' + otp);
    return { testMode: true };
  }

  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('SMS_API_URL');
  const apiToken = props.getProperty('SMS_API_TOKEN');
  const senderName = props.getProperty('SMS_SENDER_NAME') || 'BACHMAI';
  if (!apiUrl || !apiToken) throw appError_('SMS_NOT_CONFIGURED', 'Dịch vụ SMS chưa được cấu hình.');

  const response = UrlFetchApp.fetch(apiUrl, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + apiToken },
    payload: JSON.stringify({
      phone: phone,
      sender: senderName,
      message: 'Ma OTP dang ky hien tieu cau Bach Mai la ' + otp + '. Ma co hieu luc ' + APP.OTP_MINUTES + ' phut.'
    })
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw appError_('SMS_SEND_FAILED', 'Không gửi được OTP. Vui lòng thử lại hoặc liên hệ hỗ trợ.');
  }
  return { testMode: false, status: response.getResponseCode() };
}

function verifyTurnstile_(token) {
  const secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!secret) return true;
  if (!token) throw appError_('CAPTCHA_REQUIRED', 'Vui lòng hoàn thành bước xác minh bảo mật.');

  const response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    muteHttpExceptions: true,
    payload: { secret: secret, response: token }
  });
  const result = safeJsonParse_(response.getContentText(), {});
  if (!result.success) throw appError_('CAPTCHA_FAILED', 'Xác minh bảo mật không thành công.');
  return true;
}

function requirePublicSession_(token) {
  const hash = sha256_(String(token || ''));
  const row = readSystemNormalized_().find(function (item) {
    return item.type === 'OTP' && item.status === 'VERIFIED' && item.data.publicTokenHash === hash;
  });
  if (!row) throw appError_('UNAUTHORIZED', 'Phiên xác thực không hợp lệ.');
  if (new Date(row.data.publicTokenExpiresAt || row.expiresAt).getTime() < Date.now()) throw appError_('SESSION_EXPIRED', 'Phiên xác thực đã hết hạn. Vui lòng xác thực lại.');
  return { phone: row.data.phone, requestedDate: row.data.requestedDate, otpId: row.id };
}

function requireManageAccess_(code, manageToken) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const token = String(manageToken || '').trim();
  if (!normalizedCode || !token) throw appError_('UNAUTHORIZED', 'Thiếu thông tin tra cứu lịch.');
  const appointment = findAppointmentByCode_(normalizedCode);
  if (!appointment || sha256_(token) !== appointment.manageTokenHash) throw appError_('UNAUTHORIZED', 'Thông tin tra cứu lịch không hợp lệ.');
  return appointment;
}

function pushGetStatus_(data) {
  const session = requireAdmin_(data.token, ADMIN_ROLES);
  const deviceId = sanitizeText_(data.deviceId, 200);
  const config = getFirebasePublicConfig_();
  const device = deviceId ? readSystemNormalized_().find(function (item) {
    return item.type === 'PUSH_DEVICE' && item.refId === session.userId && item.data.deviceId === deviceId && item.status === 'ACTIVE';
  }) : null;
  return { enabled: config.enabled, serverReady: config.serverReady, registered: !!device };
}

function pushRegisterDevice_(data) {
  const session = requireAdmin_(data.token, ADMIN_ROLES);
  const deviceId = sanitizeText_(data.deviceId, 200);
  const fcmToken = String(data.fcmToken || '').trim();
  if (!deviceId || !fcmToken) throw appError_('INVALID_PUSH_DEVICE', 'Thiếu thông tin thiết bị nhận thông báo.');
  const config = getFirebasePublicConfig_();
  if (!config.enabled) throw appError_('PUSH_NOT_CONFIGURED', 'Firebase Push chưa được cấu hình.');

  const rows = readSystemNormalized_().filter(function (item) { return item.type === 'PUSH_DEVICE'; });
  rows.forEach(function (item) {
    if (item.data.fcmToken === fcmToken && (item.refId !== session.userId || item.data.deviceId !== deviceId)) {
      updateRowObject_(APP.SHEETS.SYSTEM, item.__row, { Status: 'REVOKED' });
    }
  });
  const existing = rows.find(function (item) { return item.refId === session.userId && item.data.deviceId === deviceId; });
  const detail = {
    deviceId: deviceId,
    fcmToken: fcmToken,
    userAgent: sanitizeText_(data.userAgent, 500),
    platform: sanitizeText_(data.platform, 100),
    updatedAt: nowIso_()
  };
  if (existing) {
    updateRowObject_(APP.SHEETS.SYSTEM, existing.__row, {
      Status: 'ACTIVE',
      ExpiresAt: '',
      DataJson: JSON.stringify(detail)
    });
  } else {
    appendObject_(APP.SHEETS.SYSTEM, {
      Id: 'PUSH_' + Utilities.getUuid(),
      Type: 'PUSH_DEVICE',
      RefId: session.userId,
      Status: 'ACTIVE',
      ExpiresAt: '',
      CreatedAt: nowIso_(),
      DataJson: JSON.stringify(detail)
    });
  }
  audit_('USER', session.userId, 'REGISTER_PUSH_DEVICE', deviceId, {});
  return { registered: true };
}

function pushUnregisterDevice_(data) {
  const session = requireAdmin_(data.token, ADMIN_ROLES);
  const deviceId = sanitizeText_(data.deviceId, 200);
  readSystemNormalized_().filter(function (item) {
    return item.type === 'PUSH_DEVICE' && item.refId === session.userId && item.data.deviceId === deviceId && item.status === 'ACTIVE';
  }).forEach(function (item) { updateRowObject_(APP.SHEETS.SYSTEM, item.__row, { Status: 'REVOKED' }); });
  audit_('USER', session.userId, 'UNREGISTER_PUSH_DEVICE', deviceId, {});
  return { registered: false };
}

function getFirebasePublicConfig_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const client = {
    apiKey: props.FIREBASE_API_KEY || '',
    authDomain: props.FIREBASE_AUTH_DOMAIN || '',
    projectId: props.FIREBASE_PROJECT_ID || '',
    messagingSenderId: props.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: props.FIREBASE_APP_ID || ''
  };
  const enabled = !!(client.apiKey && client.projectId && client.messagingSenderId && client.appId && props.FIREBASE_VAPID_KEY);
  const serverReady = !!(enabled && props.FIREBASE_SERVICE_ACCOUNT_EMAIL && props.FIREBASE_PRIVATE_KEY);
  return {
    enabled: enabled,
    serverReady: serverReady,
    firebaseConfig: client,
    vapidKey: enabled ? props.FIREBASE_VAPID_KEY : ''
  };
}

function sendNewRegistrationPush_(info) {
  if (!info) return { sent: 0, failed: 0 };
  const publicConfig = getFirebasePublicConfig_();
  if (!publicConfig.serverReady) return { sent: 0, failed: 0, skipped: true };
  const devices = readSystemNormalized_().filter(function (item) {
    return item.type === 'PUSH_DEVICE' && item.status === 'ACTIVE' && item.data.fcmToken;
  });
  if (!devices.length) return { sent: 0, failed: 0 };

  const title = 'Có lượt đăng ký hiến tiểu cầu mới';
  const body = 'Có 1 lượt đăng ký khung ' + info.startTime + '–' + info.endTime + ' ngày ' + formatDateViServer_(info.date) + '.';
  let sent = 0;
  let failed = 0;
  devices.forEach(function (device) {
    try {
      sendFcmDataMessage_(device.data.fcmToken, {
        title: title,
        body: body,
        appointmentId: info.appointmentId,
        openSection: 'appointments',
        url: buildPwaUrl_('?admin=1&section=appointments')
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      const message = String(error && error.message || '');
      if (message.indexOf('UNREGISTERED') !== -1 || message.indexOf('404') !== -1) {
        updateRowObject_(APP.SHEETS.SYSTEM, device.__row, { Status: 'INVALID' });
      }
      logError_(error);
    }
  });
  return { sent: sent, failed: failed };
}

function sendFcmDataMessage_(fcmToken, data) {
  const props = PropertiesService.getScriptProperties();
  const projectId = props.getProperty('FIREBASE_PROJECT_ID');
  const accessToken = getFcmAccessToken_();
  const stringData = {};
  Object.keys(data || {}).forEach(function (key) { stringData[key] = String(data[key] == null ? '' : data[key]); });
  const response = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/messages:send', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({
      message: {
        token: fcmToken,
        data: stringData,
        webpush: { headers: { Urgency: 'high', TTL: '3600' } }
      }
    }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) throw new Error('FCM ' + status + ': ' + text);
  return safeJsonParse_(text, {});
}

function getFcmAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('FCM_ACCESS_TOKEN');
  if (cached) return cached;
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('FIREBASE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = String(props.getProperty('FIREBASE_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Thiếu service account Firebase.');

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeText_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncodeText_(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + '.' + claim;
  const signature = Utilities.computeRsaSha256Signature(unsigned, privateKey);
  const assertion = unsigned + '.' + base64UrlEncodeBytes_(signature);
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Không lấy được FCM access token: ' + response.getContentText());
  const tokenData = JSON.parse(response.getContentText());
  cache.put('FCM_ACCESS_TOKEN', tokenData.access_token, Math.max(60, Number(tokenData.expires_in || 3600) - 300));
  return tokenData.access_token;
}

function base64UrlEncodeText_(text) {
  return base64UrlEncodeBytes_(Utilities.newBlob(String(text)).getBytes());
}

function base64UrlEncodeBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function buildPwaUrl_(suffix) {
  const base = String(PropertiesService.getScriptProperties().getProperty('PWA_BASE_URL') || '').replace(/\/$/, '');
  return base ? base + String(suffix || '') : './' + String(suffix || '').replace(/^\.\//, '');
}

function formatDateViServer_(iso) {
  const parts = String(iso || '').split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(iso || '');
}

function requireAdmin_(token, allowedRoles) {
  const tokenHash = sha256_(String(token || ''));
  const session = readSystemNormalized_().find(function (item) {
    return item.type === 'SESSION' && item.status === 'ACTIVE' && item.data.tokenHash === tokenHash;
  });
  if (!session) throw appError_('UNAUTHORIZED', 'Bạn chưa đăng nhập hoặc phiên đăng nhập không hợp lệ.');
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    updateRowObject_(APP.SHEETS.SYSTEM, session.__row, { Status: 'EXPIRED' });
    throw appError_('SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn.');
  }
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(session.data.role)) throw appError_('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
  return Object.assign({}, session.data, { __row: session.__row });
}

function canViewFullPhone_(role) {
  return ['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'SCREENING'].includes(role);
}

/* =========================
 * KHỞI TẠO CẤU HÌNH / KHUNG GIỜ
 * ========================= */

function seedGeneralConfig_() {
  if (readConfigRecords_('GENERAL_CONFIG').length) return;
  const legacy = getLegacyConfigMap_();
  const defaults = {
    appName: legacy.APP_NAME || 'HIẾN TIỂU CẦU BẠCH MAI',
    organizationLine1: legacy.ORG_LINE_1 || 'BỆNH VIỆN BẠCH MAI',
    organizationLine2: legacy.ORG_LINE_2 || 'VIỆN HUYẾT HỌC VÀ TRUYỀN MÁU BẠCH MAI',
    location: legacy.LOCATION || 'Viện Huyết học và Truyền máu Bạch Mai, Bệnh viện Bạch Mai',
    supportPhone: legacy.SUPPORT_PHONE || 'Đang cập nhật',
    workingHours: legacy.WORKING_HOURS || 'Theo lịch được công bố',
    maxBookingDays: Number(legacy.MAX_BOOKING_DAYS || 30),
    minBookingHours: Number(legacy.MIN_BOOKING_HOURS || 2),
    defaultStartTime: legacy.DEFAULT_START_TIME || '07:00',
    defaultEndTime: legacy.DEFAULT_END_TIME || '16:00',
    defaultIntervalMinutes: Number(legacy.DEFAULT_INTERVAL_MINUTES || 60),
    defaultCapacity: Number(legacy.DEFAULT_CAPACITY || 4),
    allowWeekends: toBool_(legacy.ALLOW_WEEKENDS),
    turnstileSiteKey: legacy.TURNSTILE_SITE_KEY || ''
  };
  appendConfigRecord_('CFG_GENERAL', 'GENERAL_CONFIG', 'ACTIVE', defaults);
}

function seedQuestionnaire_() {
  if (!readConfigRecords_('SCREENING_FORM').length) {
    appendConfigRecord_('FORM_DEFAULT', 'SCREENING_FORM', 'ACTIVE', {
      version: 'MẪU-1',
      title: 'Phiếu khai báo sức khỏe hiến tiểu cầu',
      note: 'Nội dung mẫu cần được Viện phê duyệt trước khi vận hành chính thức.'
    });
  }
  if (readConfigRecords_('SCREENING_QUESTION').length) return;

  const questions = [
    { id: 'Q01', group: 'Tình trạng hiện tại', text: 'Hiện tại Anh/Chị có sốt, ho, đau họng, tiêu chảy hoặc cảm thấy không khỏe không?', type: 'YES_NO', required: true, flagAnswer: 'YES', flagLevel: 'REVIEW', sortOrder: 10 },
    { id: 'Q02', group: 'Tình trạng hiện tại', text: 'Trong 07 ngày gần đây Anh/Chị có sử dụng thuốc điều trị nào không?', type: 'YES_NO', required: true, flagAnswer: 'YES', flagLevel: 'REVIEW', sortOrder: 20 },
    { id: 'Q03', group: 'Tiền sử gần đây', text: 'Trong thời gian gần đây Anh/Chị có phẫu thuật, thủ thuật, điều trị nha khoa, xăm hoặc xỏ khuyên không?', type: 'YES_NO', required: true, flagAnswer: 'YES', flagLevel: 'REVIEW', sortOrder: 30 },
    { id: 'Q04', group: 'Tiền sử gần đây', text: 'Anh/Chị có tiêm vaccine trong thời gian gần đây không?', type: 'YES_NO', required: true, flagAnswer: 'YES', flagLevel: 'REVIEW', sortOrder: 40 },
    { id: 'Q05', group: 'Tiền sử bệnh', text: 'Anh/Chị có bệnh tim mạch, huyết áp, rối loạn đông máu hoặc bệnh mạn tính đang điều trị không?', type: 'YES_NO', required: true, flagAnswer: 'YES', flagLevel: 'REVIEW', sortOrder: 50 },
    { id: 'Q06', group: 'Nguy cơ lây truyền', text: 'Anh/Chị có yếu tố nguy cơ mắc bệnh lây truyền qua đường máu cần trao đổi riêng với nhân viên y tế không?', type: 'YES_NO', required: true, flagAnswer: 'YES', flagLevel: 'HIGH', sortOrder: 60 },
    { id: 'Q07', group: 'Dành cho người có khả năng mang thai', text: 'Hiện tại Anh/Chị đang mang thai, mới sinh con hoặc đang cho con bú không?', type: 'YES_NO', required: true, flagAnswer: 'YES', flagLevel: 'REVIEW', sortOrder: 70 },
    { id: 'Q08', group: 'Thông tin bổ sung', text: 'Thông tin khác Anh/Chị muốn trao đổi với nhân viên y tế', type: 'TEXT', required: false, flagAnswer: '', flagLevel: 'NONE', sortOrder: 80 }
  ];
  questions.forEach(function (q) { appendConfigRecord_(q.id, 'SCREENING_QUESTION', 'ACTIVE', q); });
}

function seedGuidelines_() {
  if (readConfigRecords_('GUIDELINE').length) return;
  const guides = [
    { id: 'GUIDE_01', title: 'Trước khi hiến', items: ['Ngủ đủ giấc và giữ tinh thần thoải mái.', 'Ăn nhẹ, không để bụng quá đói; hạn chế thức ăn nhiều chất béo trước khi hiến.', 'Không sử dụng rượu, bia trước khi hiến và thông báo các thuốc đang sử dụng.'], sortOrder: 10 },
    { id: 'GUIDE_02', title: 'Khi đến Bệnh viện', items: ['Mang theo CCCD hoặc giấy tờ tùy thân có ảnh.', 'Đến đúng khung giờ đã đăng ký và xuất trình mã QR.', 'Thông báo ngay nếu tình trạng sức khỏe thay đổi sau khi đăng ký.'], sortOrder: 20 },
    { id: 'GUIDE_03', title: 'Lưu ý', items: ['Đăng ký trực tuyến không đồng nghĩa chắc chắn đủ điều kiện hiến.', 'Quyết định cuối cùng do nhân viên y tế đưa ra sau khám và xét nghiệm.'], sortOrder: 30 }
  ];
  guides.forEach(function (g) { appendConfigRecord_(g.id, 'GUIDELINE', 'ACTIVE', g); });
}

function seedDonationSchedule_() {
  if (findConfigRecord_('CFG_DONATION_SCHEDULE', 'DONATION_SCHEDULE')) return;
  const startDate = todayIso_();
  const endDate = addDaysIso_(startDate, 30);
  appendConfigRecord_('CFG_DONATION_SCHEDULE', 'DONATION_SCHEDULE', 'ACTIVE', {
    startDate: startDate,
    endDate: endDate,
    excludedDates: [],
    slots: FIXED_DONATION_SLOTS.map(function (slot) {
      return { id: slot.id, startTime: slot.startTime, endTime: slot.endTime, capacity: 4 };
    }),
    timezone: APP.TIMEZONE,
    updatedBy: 'SYSTEM',
    updatedAt: nowIso_()
  });
}

function getDonationSchedule_() {
  let row = findConfigRecord_('CFG_DONATION_SCHEDULE', 'DONATION_SCHEDULE');
  if (!row) {
    seedDonationSchedule_();
    row = findConfigRecord_('CFG_DONATION_SCHEDULE', 'DONATION_SCHEDULE');
  }
  return normalizeDonationSchedulePayload_(row ? row.data : {});
}

function normalizeDonationSchedulePayload_(payload) {
  const startDate = normalizeIsoDate_(payload.startDate);
  const endDate = normalizeIsoDate_(payload.endDate);
  if (!startDate || !endDate || startDate > endDate) throw appError_('INVALID_RANGE', 'Khoảng ngày tổ chức không hợp lệ.');
  const excludedDates = Array.isArray(payload.excludedDates) ? payload.excludedDates.map(normalizeIsoDate_).filter(Boolean) : [];
  const uniqueExcluded = Array.from(new Set(excludedDates));
  uniqueExcluded.forEach(function (date) {
    if (date < startDate || date > endDate) throw appError_('INVALID_EXCLUDED_DATE', 'Ngày không tổ chức phải nằm trong khoảng từ ngày đến ngày.');
  });

  const incoming = Array.isArray(payload.slots) ? payload.slots : [];
  const slots = FIXED_DONATION_SLOTS.map(function (fixed) {
    const found = incoming.find(function (item) { return String(item.id || '') === fixed.id; }) || {};
    const capacity = found.capacity === undefined ? 4 : Number(found.capacity);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100) {
      throw appError_('INVALID_CAPACITY', 'Số người mỗi khung phải là số nguyên từ 0 đến 100.');
    }
    return { id: fixed.id, startTime: fixed.startTime, endTime: fixed.endTime, capacity: capacity };
  });
  return {
    startDate: startDate,
    endDate: endDate,
    excludedDates: uniqueExcluded.sort(),
    slots: slots,
    timezone: APP.TIMEZONE,
    updatedBy: String(payload.updatedBy || ''),
    updatedAt: String(payload.updatedAt || '')
  };
}

function publicScheduleView_(schedule) {
  return {
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    excludedDates: schedule.excludedDates.slice(),
    slots: schedule.slots.map(function (slot) {
      return { id: slot.id, startTime: slot.startTime, endTime: slot.endTime, capacity: Number(slot.capacity || 0) };
    }),
    timezone: APP.TIMEZONE,
    updatedAt: schedule.updatedAt || ''
  };
}

function listGuidelines_() {
  return readConfigRecords_('GUIDELINE').filter(function (row) { return row.status === 'ACTIVE'; })
    .map(function (row) { return Object.assign({ id: row.id }, row.data); })
    .sort(function (a, b) { return Number(a.sortOrder || 0) - Number(b.sortOrder || 0); });
}

function ensureInitialAdmin_() {
  const existing = findUserByUsername_('admin');
  if (existing) return { created: false, username: existing.username, password: '' };

  const password = randomReadablePassword_();
  const salt = randomToken_(16);
  const now = nowIso_();
  const userId = 'USR_' + Utilities.getUuid();
  appendObject_(APP.SHEETS.USERS, {
    Id: userId,
    Username: 'admin',
    PasswordHash: hash_(password, salt),
    Role: 'SUPER_ADMIN',
    Status: 'ACTIVE',
    UpdatedAt: now,
    DataJson: JSON.stringify({ salt: salt, fullName: 'Quản trị hệ thống', createdAt: now }),
    UserId: userId,
    Salt: salt,
    FullName: 'Quản trị hệ thống',
    CreatedAt: now
  });
  return { created: true, username: 'admin', password: password };
}

function hasFutureSlots_() {
  const today = todayIso_();
  return readSlotsNormalized_().some(function (slot) { return slot.date >= today && slot.status === 'ACTIVE'; });
}

function generateDefaultSlots_(days) {
  const cfg = getGeneralConfig_();
  return generateSlotsRange_(
    todayIso_(),
    addDaysIso_(todayIso_(), Math.max(1, Number(days || 30)) - 1),
    cfg.defaultStartTime || '07:00',
    cfg.defaultEndTime || '16:00',
    Number(cfg.defaultIntervalMinutes || 60),
    Number(cfg.defaultCapacity || 4),
    toBool_(cfg.allowWeekends)
  );
}

function generateSlotsRange_(fromDate, toDate, startTime, endTime, intervalMinutes, capacity, includeWeekends) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existingKeys = {};
    readSlotsNormalized_().forEach(function (slot) { existingKeys[slot.date + '|' + slot.startTime + '|' + slot.endTime] = true; });
    const rows = [];
    let cursor = new Date(fromDate + 'T12:00:00+07:00');
    const endDate = new Date(toDate + 'T12:00:00+07:00');
    const now = nowIso_();

    while (cursor.getTime() <= endDate.getTime()) {
      const date = formatDate_(cursor);
      const day = cursor.getDay();
      if (includeWeekends || (day !== 0 && day !== 6)) {
        for (let start = timeToMinutes_(startTime); start + intervalMinutes <= timeToMinutes_(endTime); start += intervalMinutes) {
          const s = minutesToTime_(start);
          const e = minutesToTime_(start + intervalMinutes);
          const key = date + '|' + s + '|' + e;
          if (!existingKeys[key]) {
            rows.push({
              SlotId: 'SLT_' + Utilities.getUuid(),
              Date: date,
              StartTime: s,
              EndTime: e,
              Capacity: capacity,
              Booked: 0,
              Status: 'ACTIVE',
              UpdatedAt: now,
              DataJson: JSON.stringify({ createdAt: now })
            });
            existingKeys[key] = true;
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    appendObjects_(APP.SHEETS.SLOTS, rows);
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

/* =========================
 * CHUẨN HÓA DỮ LIỆU 6 SHEET + TƯƠNG THÍCH DÒNG CŨ
 * ========================= */

function getGeneralConfig_() {
  const row = readConfigRecords_('GENERAL_CONFIG').filter(function (item) { return item.status === 'ACTIVE'; })[0];
  if (row) return row.data;
  const legacy = getLegacyConfigMap_();
  return {
    appName: legacy.APP_NAME || 'HIẾN TIỂU CẦU BẠCH MAI',
    organizationLine1: legacy.ORG_LINE_1 || 'BỆNH VIỆN BẠCH MAI',
    organizationLine2: legacy.ORG_LINE_2 || 'VIỆN HUYẾT HỌC VÀ TRUYỀN MÁU BẠCH MAI',
    location: legacy.LOCATION || '',
    supportPhone: legacy.SUPPORT_PHONE || '',
    workingHours: legacy.WORKING_HOURS || '',
    maxBookingDays: Number(legacy.MAX_BOOKING_DAYS || 30),
    minBookingHours: Number(legacy.MIN_BOOKING_HOURS || 2),
    defaultStartTime: legacy.DEFAULT_START_TIME || '07:00',
    defaultEndTime: legacy.DEFAULT_END_TIME || '16:00',
    defaultIntervalMinutes: Number(legacy.DEFAULT_INTERVAL_MINUTES || 60),
    defaultCapacity: Number(legacy.DEFAULT_CAPACITY || 4),
    allowWeekends: toBool_(legacy.ALLOW_WEEKENDS),
    turnstileSiteKey: legacy.TURNSTILE_SITE_KEY || ''
  };
}

function getLegacyConfigMap_() {
  const map = {};
  try {
    readObjects_(APP.SHEETS.CONFIG).forEach(function (row) {
      if (row.Key) map[String(row.Key)] = row.Value;
    });
  } catch (ignored) {}
  return map;
}

function appendConfigRecord_(id, type, status, data) {
  appendObject_(APP.SHEETS.CONFIG, {
    Id: id,
    Type: type,
    Status: status || 'ACTIVE',
    UpdatedAt: nowIso_(),
    DataJson: JSON.stringify(data || {})
  });
}

function readConfigRecords_(type) {
  return readObjects_(APP.SHEETS.CONFIG).map(normalizeConfigRow_).filter(function (row) {
    return row.id && (!type || row.type === type);
  });
}

function findConfigRecord_(id, type) {
  return readConfigRecords_(type).find(function (row) { return row.id === id; }) || null;
}

function normalizeConfigRow_(row) {
  return {
    id: String(row.Id || '').trim(),
    type: String(row.Type || '').trim().toUpperCase(),
    status: String(row.Status || 'ACTIVE').trim().toUpperCase(),
    updatedAt: toIsoString_(row.UpdatedAt),
    data: safeJsonParse_(row.DataJson, {}),
    __row: row.__row
  };
}

function readUsersNormalized_() {
  return readObjects_(APP.SHEETS.USERS).map(normalizeUserRow_).filter(function (row) { return row.username; });
}

function normalizeUserRow_(row) {
  const data = safeJsonParse_(row.DataJson, {});
  return {
    id: String(row.Id || row.UserId || '').trim(),
    username: String(row.Username || '').trim().toLowerCase(),
    passwordHash: String(row.PasswordHash || ''),
    salt: String(data.salt || row.Salt || ''),
    fullName: String(data.fullName || row.FullName || row.Username || ''),
    role: String(row.Role || 'REPORT_VIEWER').trim().toUpperCase(),
    status: String(row.Status || 'ACTIVE').trim().toUpperCase(),
    updatedAt: toIsoString_(row.UpdatedAt),
    data: data,
    __row: row.__row
  };
}

function findUserByUsername_(username) {
  const value = String(username || '').trim().toLowerCase();
  return readUsersNormalized_().find(function (user) { return user.username === value; }) || null;
}

function readDonorsNormalized_() {
  return readObjects_(APP.SHEETS.DONORS).map(normalizeDonorRow_).filter(function (row) { return row.donorId && row.phone; });
}

function normalizeDonorRow_(row) {
  const data = safeJsonParse_(row.DataJson, {});
  return {
    donorId: String(row.DonorId || '').trim(),
    phone: normalizePhone_(row.Phone),
    fullName: String(row.FullName || ''),
    dateOfBirth: normalizeIsoDate_(row.DateOfBirth || row.BirthDate) || '',
    status: String(row.Status || 'ACTIVE').trim().toUpperCase(),
    updatedAt: toIsoString_(row.UpdatedAt),
    data: Object.assign({}, data, {
      gender: data.gender || row.Gender || '',
      bloodGroup: data.bloodGroup || row.BloodGroup || '',
      citizenIdLast4: data.citizenIdLast4 || row.CitizenIdLast4 || '',
      province: data.province || row.Province || '',
      email: data.email || row.Email || ''
    }),
    __row: row.__row
  };
}

function findDonorByPhone_(phone) {
  const value = normalizePhone_(phone);
  return readDonorsNormalized_().find(function (donor) { return donor.phone === value; }) || null;
}

function readAppointmentsNormalized_() {
  return readObjects_(APP.SHEETS.APPOINTMENTS).map(normalizeAppointmentRow_).filter(function (row) { return row.id; });
}

function normalizeAppointmentRow_(row) {
  const data = safeJsonParse_(row.DataJson, {});
  return {
    id: String(row.Id || row.AppointmentId || '').trim(),
    code: String(data.code || row.Code || '').trim().toUpperCase(),
    donorId: String(row.DonorId || '').trim(),
    phone: normalizePhone_(row.Phone),
    fullName: String(data.fullName || row.FullName || ''),
    birthDate: normalizeIsoDate_(data.birthDate || row.BirthDate) || '',
    gender: String(data.gender || row.Gender || ''),
    appointmentDate: normalizeIsoDate_(row.AppointmentDate || row.Date) || '',
    slotId: String(row.SlotId || '').trim(),
    startTime: normalizeTime_(data.startTime || row.StartTime) || '',
    endTime: normalizeTime_(data.endTime || row.EndTime) || '',
    status: String(row.Status || 'CONFIRMED').trim().toUpperCase(),
    riskLevel: String(data.riskLevel || row.RiskLevel || 'NONE').trim().toUpperCase(),
    answers: data.answers || safeJsonParse_(row.AnswersJson, {}),
    manageTokenHash: String(data.manageTokenHash || row.ManageTokenHash || ''),
    checkInTokenHash: String(data.checkInTokenHash || row.CheckInTokenHash || ''),
    createdAt: toIsoString_(row.CreatedAt),
    updatedAt: toIsoString_(row.UpdatedAt),
    checkInAt: String(data.checkInAt || row.CheckInAt || ''),
    completedAt: String(data.completedAt || row.CompletedAt || ''),
    cancelReason: String(data.cancelReason || row.CancelReason || ''),
    notes: String(data.notes || row.Notes || ''),
    data: data,
    __row: row.__row
  };
}

function findAppointmentById_(id) {
  const value = String(id || '').trim();
  return readAppointmentsNormalized_().find(function (item) { return item.id === value; }) || null;
}

function findAppointmentByCode_(code) {
  const value = String(code || '').trim().toUpperCase();
  return readAppointmentsNormalized_().find(function (item) { return item.code === value; }) || null;
}

function readSlotsNormalized_() {
  return readObjects_(APP.SHEETS.SLOTS).map(normalizeSlotRow_).filter(function (row) { return row.slotId; });
}

function normalizeSlotRow_(row) {
  return {
    slotId: String(row.SlotId || '').trim(),
    date: normalizeIsoDate_(row.Date) || '',
    startTime: normalizeTime_(row.StartTime) || '',
    endTime: normalizeTime_(row.EndTime) || '',
    capacity: Math.max(0, Number(row.Capacity || 0)),
    booked: Math.max(0, Number(row.Booked || 0)),
    status: String(row.Status || 'ACTIVE').trim().toUpperCase(),
    updatedAt: toIsoString_(row.UpdatedAt),
    data: safeJsonParse_(row.DataJson, {}),
    __row: row.__row
  };
}

function findSlotById_(slotId) {
  const value = String(slotId || '').trim();
  return readSlotsNormalized_().find(function (slot) { return slot.slotId === value; }) || null;
}

function setSlotBooked_(slot, booked) {
  updateRowObject_(APP.SHEETS.SLOTS, slot.__row, { Booked: Math.max(0, Number(booked || 0)), UpdatedAt: nowIso_() });
}

function readSystemNormalized_() {
  return readObjects_(APP.SHEETS.SYSTEM).map(normalizeSystemRow_).filter(function (row) { return row.id; });
}

function normalizeSystemRow_(row) {
  return {
    id: String(row.Id || '').trim(),
    type: String(row.Type || '').trim().toUpperCase(),
    refId: String(row.RefId || '').trim(),
    status: String(row.Status || '').trim().toUpperCase(),
    expiresAt: toIsoString_(row.ExpiresAt),
    createdAt: toIsoString_(row.CreatedAt),
    data: safeJsonParse_(row.DataJson, {}),
    __row: row.__row
  };
}

function findSystemById_(id, type) {
  return readSystemNormalized_().find(function (item) { return item.id === id && (!type || item.type === type); }) || null;
}

function updateSystemRow_(row, patch, data) {
  const update = Object.assign({}, patch || {});
  if (data !== undefined) update.DataJson = JSON.stringify(data || {});
  updateRowObject_(APP.SHEETS.SYSTEM, row.__row, update);
}

/* =========================
 * NHẬT KÝ / THÔNG BÁO
 * ========================= */

function audit_(actorType, actorId, action, targetId, detail) {
  appendObject_(APP.SHEETS.SYSTEM, {
    Id: 'AUD_' + Utilities.getUuid(),
    Type: 'AUDIT',
    RefId: String(targetId || ''),
    Status: 'RECORDED',
    ExpiresAt: '',
    CreatedAt: nowIso_(),
    DataJson: JSON.stringify({ actorType: actorType, actorId: actorId, action: action, detail: detail || {} })
  });
}

function queueNotification_(appointmentId, recipient, channel, templateCode) {
  appendObject_(APP.SHEETS.SYSTEM, {
    Id: 'NOT_' + Utilities.getUuid(),
    Type: 'NOTIFICATION',
    RefId: String(appointmentId || ''),
    Status: 'PENDING',
    ExpiresAt: '',
    CreatedAt: nowIso_(),
    DataJson: JSON.stringify({ recipient: recipient, channel: channel, templateCode: templateCode, providerResponse: '', sentAt: '' })
  });
}

function logError_(error) {
  if (!getDb_()) return;
  appendObject_(APP.SHEETS.SYSTEM, {
    Id: 'ERR_' + Utilities.getUuid(),
    Type: 'ERROR_LOG',
    RefId: '',
    Status: 'NEW',
    ExpiresAt: '',
    CreatedAt: nowIso_(),
    DataJson: JSON.stringify({ code: error && error.code ? error.code : 'SERVER_ERROR', message: error && error.message ? error.message : String(error), stack: error && error.stack ? String(error.stack).slice(0, 5000) : '' })
  });
}

/* =========================
 * GOOGLE SHEET HELPERS
 * ========================= */

function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Không xác định được Google Sheet. Hãy chạy setSpreadsheetId("ID_GOOGLE_SHEET") hoặc mở Apps Script từ Google Sheet.');
  return active;
}

function getSheet_(name) {
  const sheet = getDb_().getSheetByName(name);
  if (!sheet) throw new Error('Không tìm thấy sheet ' + name + '. Hãy chạy setupApp() một lần.');
  return sheet;
}

function ensureSheet_(ss, name, requiredHeaders) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const lastColumn = Math.max(1, sheet.getLastColumn());
  let headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function (value) { return String(value || '').trim(); });
  if (headers.every(function (value) { return !value; })) headers = [];

  const missing = requiredHeaders.filter(function (header) { return headers.indexOf(header) === -1; });
  if (!headers.length) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
  } else if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function readObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function (value) { return String(value || '').trim(); });
  return values.slice(1).map(function (row, index) {
    const obj = { __row: index + 2 };
    headers.forEach(function (header, column) { if (header) obj[header] = row[column]; });
    return obj;
  }).filter(function (obj) {
    return headers.some(function (header) { return header && obj[header] !== '' && obj[header] !== null; });
  });
}

function appendObject_(sheetName, obj) {
  appendObjects_(sheetName, [obj]);
}

function appendObjects_(sheetName, objects) {
  if (!objects || !objects.length) return;
  const sheet = getSheet_(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function (value) { return String(value || '').trim(); });
  const rows = objects.map(function (obj) {
    return headers.map(function (header) { return Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : ''; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function updateRowObject_(sheetName, rowNumber, patch) {
  const sheet = getSheet_(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function (value) { return String(value || '').trim(); });
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  let changed = false;
  headers.forEach(function (header, index) {
    if (header && Object.prototype.hasOwnProperty.call(patch, header)) {
      row[index] = patch[header];
      changed = true;
    }
  });
  if (changed) sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

/* =========================
 * TIỆN ÍCH
 * ========================= */

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) throw appError_('EMPTY_REQUEST', 'Yêu cầu không có dữ liệu.');
  try { return JSON.parse(e.postData.contents); }
  catch (error) { throw appError_('INVALID_JSON', 'Dữ liệu gửi lên không phải JSON hợp lệ.'); }
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function appError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hash_(value, salt) {
  return sha256_(String(salt || '') + '|' + String(value || ''));
}

function sha256_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function randomToken_(bytes) {
  const seed = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now() + '|' + Math.random();
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed)).replace(/=+$/g, '').slice(0, bytes * 2);
}

function randomReadablePassword_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';
  let out = '';
  for (let i = 0; i < 12; i += 1) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return out;
}

function validatePassword_(password) {
  const value = String(password || '');
  if (value.length < 10 || !/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    throw new Error('Mật khẩu phải có ít nhất 10 ký tự, gồm chữ hoa, chữ thường và số.');
  }
}

function normalizePhone_(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.indexOf('84') === 0 && phone.length === 11) phone = '0' + phone.slice(2);
  return /^0\d{9}$/.test(phone) ? phone : '';
}

function maskPhone_(phone) {
  const value = String(phone || '');
  return value.length >= 7 ? value.slice(0, 3) + '***' + value.slice(-3) : value;
}

function normalizeName_(value) {
  return sanitizeText_(value, 100).replace(/\s+/g, ' ').trim();
}

function sanitizeText_(value, maxLength) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLength || 500);
}

function normalizeIsoDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, APP.TIMEZONE, 'yyyy-MM-dd');
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(text + 'T00:00:00+07:00');
  return isNaN(date.getTime()) || formatDate_(date) !== text ? '' : text;
}

function normalizeTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, APP.TIMEZONE, 'HH:mm');
  const text = String(value || '').trim().slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : '';
}

function parseLocalDateTime_(date, time) {
  return new Date(date + 'T' + time + ':00+07:00');
}

function formatDate_(date) {
  return Utilities.formatDate(date, APP.TIMEZONE, 'yyyy-MM-dd');
}

function addDaysIso_(iso, days) {
  const date = new Date(iso + 'T12:00:00+07:00');
  date.setDate(date.getDate() + Number(days || 0));
  return formatDate_(date);
}

function todayIso_() {
  return Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
}

function nowIso_() {
  return new Date().toISOString();
}

function toIsoString_(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  const date = new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function timeToMinutes_(time) {
  const parts = String(time || '').split(':');
  return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

function minutesToTime_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function toBool_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function safeJsonParse_(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return value ? JSON.parse(String(value)) : fallback; }
  catch (error) { return fallback; }
}

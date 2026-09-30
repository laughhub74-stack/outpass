import React, { useState, useEffect } from "react";
import axios from "axios";
import QRCode from "react-qr-code";
import { renderToStaticMarkup } from "react-dom/server";
import { PlusCircle, Calendar, MapPin, ClipboardList, RefreshCw, LogOut, CheckCircle, QrCode, FileText, ArrowRight, User } from "lucide-react";
import { showSuccessToast, useErrorState } from "../components/Toaster";
import Pagination from "../components/Pagination";
import PasswordInput from "../components/PasswordInput";

export default function StudentDashboard({ token, userName, onLogout, apiUrl }) {
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [outDate, setOutDate] = useState("");
  const [inDate, setInDate] = useState("");

  const [requests, setRequests] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pageMeta, setPageMeta] = useState({ total: 0, totalPages: 0 });
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [, setError] = useErrorState();
  const [message, setMessage] = useState("");
  
  const [selectedQR, setSelectedQR] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchHistory = async (requestedPage = page, requestedPageSize = pageSize) => {
    try {
      const res = await axios.get(`${apiUrl}/api/outpass/my-requests`, { headers, params: { page: requestedPage, page_size: requestedPageSize } });
      setRequests(res.data.items);
      setPageMeta({ total: res.data.total, totalPages: res.data.total_pages || res.data.totalPages });
    } catch (err) {
      console.error("Failed to load requests", err);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${apiUrl}/api/auth/me`, { headers });
      setProfile(res.data);
    } catch (err) {
      console.error("Failed to load student profile", err);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError("");

    if (passwordForm.new_password.length < 6) {
      setError("New password must be at least 6 characters long.");
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setError("New password and confirmation do not match.");
      return;
    }

    try {
      setChangingPassword(true);
      await axios.post(`${apiUrl}/api/auth/change-password`, {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
        confirm_password: passwordForm.confirm_password,
      }, { headers });
      showSuccessToast("Password updated successfully.");
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
      setShowPasswordForm(false);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Failed to update password.");
    } finally {
      setChangingPassword(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchProfile();
    const interval = setInterval(fetchHistory, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleApply = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      await axios.post(
        `${apiUrl}/api/outpass/apply`,
        {
          destination,
          reason,
          out_date: new Date(outDate).toISOString(),
          in_date: new Date(inDate).toISOString(),
        },
        { headers }
      );
      showSuccessToast("Outpass request submitted successfully!");
      setDestination("");
      setReason("");
      setOutDate("");
      setInDate("");
      fetchHistory();
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        const msg = detail.map(d => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join(", ");
        setError(msg);
      } else if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("Failed to submit request.");
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const config = {
      "Pending": { bg: "bg-amber-50 text-amber-700 border-amber-200/50", label: "Pending Advisor" },
      "Advisor Approved": { bg: "bg-blue-50 text-blue-700 border-blue-200/50", label: "Pending HOD" },
      "HOD Approved": { bg: "bg-indigo-50 text-indigo-700 border-indigo-200/50", label: "Pending Warden" },
      "Approved": { bg: "bg-emerald-50 text-emerald-700 border-emerald-200/50", label: "Approved (Active)" },
      "Student Left": { bg: "bg-purple-50 text-purple-700 border-purple-200/50", label: "Checked Out" },
      "Student Returned": { bg: "bg-teal-50 text-teal-700 border-teal-200/50", label: "Checked In" },
      "Rejected": { bg: "bg-red-50 text-red-700 border-red-200/50", label: "Rejected" }
    };
    const c = config[status] || { bg: "bg-gray-100 text-gray-700 border-gray-200", label: status };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${c.bg}`}>
        {c.label}
      </span>
    );
  };

  // Extract specific approval action dates/names from outpass audit logs history
  const getApprovalStamp = (history, role) => {
    const statusMap = {
      advisor: "Advisor Approved",
      hod: "HOD Approved",
      warden: "Approved"
    };
    const targetStatus = statusMap[role];
    const item = history?.find(h => h.status === targetStatus);
    if (!item) return null;
    return {
      name: item.updated_by_name,
      time: new Date(item.updated_at).toLocaleString()
    };
  };

  // Dynamically calculate detailed validity status for digital passes
  const getValidityStatus = (req) => {
    if (req.status === "Student Returned") {
      return { text: "CHECKED IN / USED", color: "bg-gray-100 text-gray-500 border-gray-200" };
    }
    if (req.status === "Student Left") {
      return { text: "CHECKED OUT / ACTIVE", color: "bg-purple-100 text-purple-700 border-purple-200" };
    }
    
    // Default Approved status range checks
    const now = new Date();
    const inDateVal = new Date(req.in_date);
    const outDateVal = new Date(req.out_date);
    
    if (now > inDateVal) {
      return { text: "EXPIRED PASS", color: "bg-red-100 text-red-600 border-red-200" };
    }
    if (now >= outDateVal && now <= inDateVal) {
      return { text: "ACTIVE / NOT DEPARTED", color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    }
    return { text: "APPROVED / DEPARTURE PENDING", color: "bg-blue-100 text-blue-700 border-blue-200" };
  };

  // Print Outpass helper with boarding-pass style detailed layout
  const handlePrintPass = (req) => {
    const printWindow = window.open("", "_blank");
    const advisorStamp = getApprovalStamp(req.history, "advisor");
    const wardenStamp = getApprovalStamp(req.history, "warden");
    const hodStamp = getApprovalStamp(req.history, "hod");
    const validity = getValidityStatus(req);
    const printableQr = renderToStaticMarkup(
      <QRCode value={req.qr_token} size={110} className="qr-code" title="Outpass QR code" />
    );

    printWindow.document.write(`
      <html>
        <head>
          <title>Print Digital Outpass - ${req.student_name}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');
            body { 
              font-family: 'Outfit', 'Inter', sans-serif; 
              padding: 20px; 
              color: #111111; 
              background-color: #eaedf0; 
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 90vh;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .ticket-container {
              width: 380px;
              background: #ffffff;
              border: 1px solid rgba(0, 0, 0, 0.08);
              border-radius: 28px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.05);
              overflow: hidden;
            }
            .header-bar {
              background: linear-gradient(135deg, #059669 0%, #0d9488 100%);
              color: #ffffff;
              padding: 16px 24px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .brand-name {
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .validity-tag {
              font-size: 9px;
              font-weight: 700;
              background: rgba(255, 255, 255, 0.2);
              padding: 3px 8px;
              border-radius: 12px;
              text-transform: uppercase;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .body-section {
              padding: 24px;
            }
            .student-info {
              display: flex;
              align-items: center;
              gap: 12px;
              margin-bottom: 20px;
            }
            .avatar {
              width: 44px;
              height: 44px;
              border-radius: 12px;
              background: #f4f8ff;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 18px;
              font-weight: 900;
              color: #111111;
              border: 1px solid rgba(0,0,0,0.05);
            }
            .student-meta h4 {
              margin: 0;
              font-size: 15px;
              font-weight: 700;
              color: #111111;
            }
            .student-meta p {
              margin: 2px 0 0 0;
              font-size: 11px;
              font-family: monospace;
              color: #666;
            }
            .grid-details {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              margin-bottom: 20px;
            }
            .detail-box {
              background: #f8fafc;
              border: 1px solid rgba(0,0,0,0.04);
              padding: 10px;
              border-radius: 12px;
            }
            .label {
              font-size: 9px;
              color: #666;
              text-transform: uppercase;
              font-weight: 700;
              letter-spacing: 0.5px;
              margin-bottom: 2px;
              display: block;
            }
            .value {
              font-size: 12px;
              font-weight: 700;
              color: #111111;
            }
            .date-range {
              background: #f8fafc;
              border: 1px solid rgba(0,0,0,0.04);
              padding: 12px;
              border-radius: 12px;
              margin-bottom: 20px;
            }
            .date-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 11px;
            }
            .date-row:first-child {
              border-bottom: 1px solid rgba(0,0,0,0.04);
              padding-bottom: 8px;
              margin-bottom: 8px;
            }
            .date-val {
              font-weight: 700;
              font-family: monospace;
            }
            .reason-box {
              border: 1px solid rgba(0,0,0,0.04);
              padding: 10px 12px;
              border-radius: 12px;
              background: #faf5ef;
              margin-bottom: 20px;
              font-size: 11px;
              font-style: italic;
              color: #4a5568;
            }
            .stamp-section {
              border-top: 1px solid rgba(0,0,0,0.05);
              padding-top: 16px;
            }
            .stamps-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 8px;
            }
            .stamp-box {
              border: 1px dashed rgba(0,0,0,0.1);
              background: rgba(16, 185, 129, 0.04);
              border-radius: 10px;
              padding: 8px 4px;
              text-align: center;
              font-size: 8px;
            }
            .stamp-box.pending {
              background: none;
              color: #888;
            }
            .stamp-role {
              font-weight: 900;
              text-transform: uppercase;
              color: #047857;
              display: block;
              margin-bottom: 2px;
            }
            .stamp-box.pending .stamp-role {
              color: #888;
            }
            .stamp-name {
              font-weight: 600;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              display: block;
            }
            .stamp-time {
              color: #666;
              font-size: 7px;
              display: block;
            }
            .ticket-notch {
              position: relative;
              height: 20px;
              display: flex;
              align-items: center;
              background: #eaedf0;
            }
            .notch-l {
              width: 14px;
              height: 20px;
              background: #eaedf0;
              border-radius: 0 10px 10px 0;
              border: 1px solid rgba(0, 0, 0, 0.08);
              border-left: none;
              position: absolute;
              left: 0;
            }
            .notch-r {
              width: 14px;
              height: 20px;
              background: #eaedf0;
              border-radius: 10px 0 0 10px;
              border: 1px solid rgba(0, 0, 0, 0.08);
              border-right: none;
              position: absolute;
              right: 0;
            }
            .divider-line {
              width: 100%;
              border-top: 2px dashed rgba(0, 0, 0, 0.08);
              margin: 0 18px;
            }
            .stub-section {
              padding: 20px 24px;
              text-align: center;
            }
            .qr-wrapper {
              background: #f8fafc;
              border: 1px solid rgba(0,0,0,0.04);
              padding: 12px;
              border-radius: 16px;
              width: fit-content;
              margin: 0 auto 10px auto;
            }
            .qr-code {
              width: 110px;
              height: 110px;
              display: block;
            }
            .qr-text {
              font-family: monospace;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.5px;
              color: #111;
              margin-top: 6px;
            }
          </style>
        </head>
        <body>
          <div class="ticket-container">
            <div class="header-bar">
              <span class="brand-name">H.O.M.S Digital Pass</span>
              <span class="validity-tag">${validity.text}</span>
            </div>
            
            <div class="body-section">
              <div class="student-info">
                <div class="avatar">${req.student_name.charAt(0)}</div>
                <div class="student-meta">
                  <h4>${req.student_name}</h4>
                  <p>${req.roll_number}</p>
                </div>
              </div>
              
              <div class="grid-details">
                <div class="detail-box">
                  <span class="label">Hostel Block</span>
                  <div class="value">${req.hostel_name || "N/A"}</div>
                  <div class="value" style="font-size: 10px; color: #666; font-weight: 500;">Room ${req.room || "N/A"}</div>
                </div>
                <div class="detail-box">
                  <span class="label">Destination</span>
                  <div class="value" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${req.destination}</div>
                </div>
              </div>
              
              <div class="date-range">
                <div class="date-row">
                  <span class="label" style="margin:0;">Leave Scheduled</span>
                  <span class="date-val">${new Date(req.out_date).toLocaleString()}</span>
                </div>
                <div class="date-row">
                  <span class="label" style="margin:0;">Return Scheduled</span>
                  <span class="date-val">${new Date(req.in_date).toLocaleString()}</span>
                </div>
              </div>
              
              <div class="reason-box">
                <span class="label" style="margin-bottom: 2px;">Stated Leave Purpose</span>
                "${req.reason}"
              </div>
              
              <div class="stamp-section">
                <span class="label" style="margin-bottom: 8px;">Clearance Stamp Registry</span>
                <div class="stamps-grid">
                  <div class="stamp-box ${advisorStamp ? '' : 'pending'}">
                    <span class="stamp-role">Advisor</span>
                    ${advisorStamp ? `
                      <span class="stamp-name">${advisorStamp.name}</span>
                      <span class="stamp-time">${advisorStamp.time.split(',')[0]}</span>
                    ` : '<span class="stamp-name">Pending</span>'}
                  </div>
                  <div class="stamp-box ${hodStamp ? '' : 'pending'}">
                    <span class="stamp-role">HOD</span>
                    ${hodStamp ? `
                      <span class="stamp-name">${hodStamp.name}</span>
                      <span class="stamp-time">${hodStamp.time.split(',')[0]}</span>
                    ` : '<span class="stamp-name">Pending</span>'}
                  </div>
                  <div class="stamp-box ${wardenStamp ? '' : 'pending'}">
                    <span class="stamp-role">Warden</span>
                    ${wardenStamp ? `
                      <span class="stamp-name">${wardenStamp.name}</span>
                      <span class="stamp-time">${wardenStamp.time.split(',')[0]}</span>
                    ` : '<span class="stamp-name">Pending</span>'}
                  </div>
                </div>
              </div>
            </div>
            
            <div class="ticket-notch">
              <div class="notch-l"></div>
              <div class="divider-line"></div>
              <div class="notch-r"></div>
            </div>
            
            <div class="stub-section">
              <div class="qr-wrapper">
                ${printableQr}
                <div class="qr-text">${req.qr_token}</div>
              </div>
              <div class="label" style="text-align: center; font-size: 8px;">Security Scan Token</div>
            </div>
          </div>
          
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };


  const selectedQRValidity = selectedQR ? getValidityStatus(selectedQR) : null;
  const selectedQRAdvisorStamp = selectedQR ? getApprovalStamp(selectedQR.history, "advisor") : null;
  const selectedQRWardenStamp = selectedQR ? getApprovalStamp(selectedQR.history, "warden") : null;
  const selectedQRHODStamp = selectedQR ? getApprovalStamp(selectedQR.history, "hod") : null;

  return (
    <div className="min-h-screen premium-bg p-4 sm:p-6 font-sans relative">
      <div className="absolute inset-0 noise-overlay pointer-events-none z-0" />

      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8 z-10 relative">
        {/* Top Navbar */}
        <header className="flex items-center justify-between py-3 sm:py-4 border-b border-border-premium">
          <div className="flex items-center gap-3">
            {profile?.photo ? (
              <img src={profile.photo} alt={`${profile.name || userName} profile`} className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl object-cover border border-border-premium shadow-sm" />
            ) : (
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-pure-white flex items-center justify-center border border-border-premium shadow-sm">
                <User size={18} className="text-primary-text" />
              </div>
            )}
            <div>
              <span className="text-[10px] sm:text-xs text-muted-text uppercase font-bold tracking-widest">Portal</span>
              <h2 className="text-base sm:text-lg font-bold text-primary-text leading-none">Student Workspace</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {userName && (
              <span className="hidden sm:inline text-xs font-semibold text-muted-text">
                Welcome, <span className="text-primary-text">{userName}</span>
              </span>
            )}
            <button
              onClick={onLogout}
              className="btn-premium btn-premium-secondary !h-9 sm:!h-10 text-xs gap-1.5 px-3"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Dashboard Title Banner */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 sm:space-y-2">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-primary-text">Outpass Panel</h1>
            <p className="text-xs sm:text-sm text-secondary-text">Request hostel leave clearance and access gate QR codes instantly.</p>
          </div>

          <button
            type="button"
            onClick={() => setShowPasswordForm((prev) => !prev)}
            className="btn-premium btn-premium-secondary !h-9 sm:!h-10 text-xs gap-1.5 px-3 self-start"
          >
            <span>Change Password</span>
          </button>
        </div>

        {showPasswordForm && (
          <section className="card-premium p-4 sm:p-5 bg-pure-white">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-premium">
              <h3 className="text-sm font-bold text-primary-text">Update Your Password</h3>
            </div>
            <form onSubmit={handleChangePassword} className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary-text mb-1.5 ml-1">Current Password</label>
                <PasswordInput
                  value={passwordForm.current_password}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))}
                  className="input-premium"
                  placeholder="Enter current password"
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary-text mb-1.5 ml-1">New Password</label>
                <PasswordInput
                  value={passwordForm.new_password}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))}
                  className="input-premium"
                  placeholder="Enter new password"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-secondary-text mb-1.5 ml-1">Confirm Password</label>
                <div className="flex gap-2">
                  <PasswordInput
                    value={passwordForm.confirm_password}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
                    className="input-premium"
                    containerClassName="flex-1"
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                  />
                  <button type="submit" disabled={changingPassword} className="btn-premium btn-premium-primary !h-11 !px-4 text-xs disabled:opacity-50">
                    {changingPassword ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          
          {/* Apply Form Card (5 cols) */}
          <section className="lg:col-span-5 card-premium p-4 sm:p-6 bg-pure-white">
            <div className="flex items-center justify-between mb-4 sm:mb-6 pb-3 sm:pb-4 border-b border-border-premium">
              <h3 className="text-sm sm:text-base font-bold text-primary-text flex items-center gap-2">
                <PlusCircle size={18} className="text-primary-text" />
                <span>Apply for Outpass</span>
              </h3>
            </div>

            {message && (
              <div className="mb-4 p-3.5 bg-success-surface border border-emerald-200/50 text-emerald-800 text-xs sm:text-sm rounded-2xl">
                {message}
              </div>
            )}

            <form onSubmit={handleApply} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-secondary-text mb-1.5 ml-1 uppercase tracking-wider">Destination</label>
                <div className="relative">
                  <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. City Center Mall"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className="input-premium input-premium-icon"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-secondary-text mb-1.5 ml-1 uppercase tracking-wider">Reason for Leave</label>
                <div className="relative">
                  <ClipboardList size={16} className="absolute left-4 top-4 text-muted-text" />
                  <textarea
                    required
                    rows="3"
                    placeholder="Provide details about the purpose of your leave..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="textarea-premium textarea-premium-icon"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-secondary-text mb-1.5 ml-1 uppercase tracking-wider">Exit Time</label>
                  <div className="relative">
                    <Calendar size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-text" />
                    <input
                      type="datetime-local"
                      required
                      value={outDate}
                      onChange={(e) => setOutDate(e.target.value)}
                      className="input-premium input-premium-icon !pl-10 pr-2 text-[11px] font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-secondary-text mb-1.5 ml-1 uppercase tracking-wider">Return Time</label>
                  <div className="relative">
                    <Calendar size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-text" />
                    <input
                      type="datetime-local"
                      required
                      value={inDate}
                      onChange={(e) => setInDate(e.target.value)}
                      className="input-premium input-premium-icon !pl-10 pr-2 text-[11px] font-semibold"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-premium btn-premium-primary mt-4 sm:mt-6 text-xs sm:text-sm"
              >
                {loading ? "Submitting application..." : "Apply Outpass Request"}
              </button>
            </form>
          </section>

          {/* History Section (7 cols) */}
          <section className="lg:col-span-7 space-y-4 sm:space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-base sm:text-lg font-bold text-primary-text flex items-center gap-2">
                <FileText size={18} className="text-secondary-text" />
                <span>Outpass History</span>
              </h3>
              <button
                onClick={fetchHistory}
                className="btn-premium btn-premium-secondary !h-8 !w-8 sm:!h-9 sm:!w-9 !p-0"
                title="Refresh History"
              >
                <RefreshCw size={14} className="icon-hover-rotate" />
              </button>
            </div>

            {requests.length === 0 ? (
              <div className="card-premium p-6 sm:p-8 bg-elevated-surface text-center text-muted-text text-xs sm:text-sm">
                No leave requests found. Complete the form to apply for your first outpass.
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="card-premium p-4 sm:p-6 bg-pure-white hover:shadow-md transition-all duration-300"
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-3 mb-3 sm:mb-4 pb-2.5 sm:pb-3 border-b border-border-premium">
                      <div>
                        <span className="text-[10px] text-muted-text uppercase font-bold tracking-wider">Pass ID: {req.id?.substring(0, 8)}...</span>
                        <p className="text-[11px] text-muted-text mt-0.5">Applied: {new Date(req.created_at).toLocaleDateString()}</p>
                      </div>
                      <div>{getStatusBadge(req.status)}</div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-text">Destination</span>
                        <p className="text-xs sm:text-sm font-semibold text-primary-text">{req.destination}</p>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-text">Validity Schedule</span>
                        <p className="text-[11px] sm:text-xs font-semibold text-primary-text">
                          {new Date(req.out_date).toLocaleString()} - {new Date(req.in_date).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="bg-secondary-surface p-3 rounded-2xl mb-3 sm:mb-4 border border-border-premium text-xs">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-muted-text block mb-0.5">Reason</span>
                      <p className="italic text-secondary-text">"{req.reason}"</p>
                    </div>

                    {req.rejection_reason && (
                      <div className="mb-3 sm:mb-4 p-3 bg-red-50 border border-red-100 text-red-700 text-xs rounded-xl">
                        <strong>Rejection Feedback:</strong> {req.rejection_reason}
                      </div>
                    )}

                    {/* Stepper Workflow Timeline */}
                    <div className="mb-3 sm:mb-4">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-muted-text block mb-1.5">Workflow Journey</span>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                        <span className="text-emerald-600">Submitted</span>
                        <ArrowRight size={11} className="text-muted-text" />
                        
                        {req.history.some(h => h.status === "Advisor Approved") ? (
                          <span className="text-emerald-600">Advisor Approved</span>
                        ) : (
                          <span className="text-muted-text">Advisor Review</span>
                        )}
                        <ArrowRight size={11} className="text-muted-text" />

                        {req.history.some(h => h.status === "HOD Approved") ? (
                          <span className="text-emerald-600">HOD Approved</span>
                        ) : (
                          <span className="text-muted-text">HOD Review</span>
                        )}
                        <ArrowRight size={11} className="text-muted-text" />

                        {req.history.some(h => h.status === "Approved") ? (
                          <span className="text-emerald-600">Approved</span>
                        ) : req.status === "Rejected" ? (
                          <span className="text-red-600">Rejected</span>
                        ) : (
                          <span className="text-muted-text">Warden Final</span>
                        )}
                      </div>
                    </div>

                    {/* Exit/Entry Timestamps */}
                    {(req.exit_time || req.entry_time) && (
                      <div className="border-t border-border-premium pt-2.5 mt-2.5 flex flex-wrap gap-3 text-[11px] font-semibold text-secondary-text">
                        {req.exit_time && (
                          <span>Actual Exit Check-out: <strong className="text-primary-text">{new Date(req.exit_time).toLocaleString()}</strong></span>
                        )}
                        {req.entry_time && (
                          <span>Actual Return Check-in: <strong className="text-primary-text">{new Date(req.entry_time).toLocaleString()}</strong></span>
                        )}
                      </div>
                    )}

                    {/* View QR Code Button */}
                    {["Approved", "Student Left", "Student Returned"].includes(req.status) && req.qr_token && (
                      <div className="flex justify-end pt-2.5 border-t border-border-premium mt-2.5">
                        <button
                          onClick={() => setSelectedQR(req)}
                          className="btn-premium btn-premium-primary !h-9 text-xs gap-1.5 px-3"
                        >
                          <QrCode size={14} />
                          <span>Show Digital Ticket</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Pagination
              page={page}
              pageSize={pageSize}
              total={pageMeta.total}
              totalPages={pageMeta.totalPages}
              onPageChange={(nextPage) => { setPage(nextPage); fetchHistory(nextPage); }}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); fetchHistory(1, size); }}
            />
          </section>
        </div>
      </div>

      {/* QR Code Modal Dialog with Sleek Compact Height & Tilt Interaction */}
      {selectedQR && (
        <div className="fixed inset-0 bg-primary-bg/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-50 transition-all duration-300">
          <div
            className="bg-pure-white border border-border-premium rounded-[28px] max-w-md w-full overflow-hidden shadow-2xl relative max-h-[85vh] flex flex-col my-auto"
          >
            {/* Boarding pass top header bar */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-5 py-3 flex justify-between items-center relative shrink-0">
              <div className="flex items-center gap-2">
                <QrCode size={16} className="text-white/90" />
                <span className="text-[10px] font-black tracking-widest uppercase">H.O.M.S Digital Pass</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[8px] sm:text-[9px] font-bold bg-white/20 uppercase tracking-wide text-white border border-white/10">
                {selectedQRValidity?.text}
              </span>
            </div>

            {/* Main Ticket Body (Scrollable if height compressed) */}
            <div className="p-4 sm:p-5 space-y-3.5 pb-4 text-left overflow-y-auto flex-1">
              {/* Student Info header */}
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cool-accent border border-border-premium flex items-center justify-center text-primary-text font-black text-base shadow-sm">
                  {selectedQR.student_name.charAt(0)}
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-primary-text leading-tight">{selectedQR.student_name}</h4>
                  <p className="text-[9px] sm:text-[10px] text-muted-text font-mono uppercase tracking-wider font-semibold">{selectedQR.roll_number}</p>
                </div>
              </div>

              {/* Grid details */}
              <div className="grid grid-cols-2 gap-2.5 text-[11px]">
                <div className="bg-secondary-surface/40 p-2.5 rounded-xl border border-border-premium">
                  <span className="text-muted-text text-[8px] uppercase tracking-wider block font-bold mb-0.5">Hostel Room</span>
                  <span className="text-primary-text font-bold block leading-tight">{selectedQR.hostel_name || "N/A"}</span>
                  <span className="text-muted-text text-[9px] font-mono mt-0.5 block">Room {selectedQR.room || "N/A"}</span>
                </div>
                <div className="bg-secondary-surface/40 p-2.5 rounded-xl border border-border-premium">
                  <span className="text-muted-text text-[8px] uppercase tracking-wider block font-bold mb-0.5">Destination</span>
                  <span className="text-primary-text font-bold block truncate leading-tight" title={selectedQR.destination}>
                    {selectedQR.destination}
                  </span>
                  <span className="text-muted-text text-[9px] mt-0.5 block">Authorized Outpass</span>
                </div>
              </div>

              {/* Validity dates */}
              <div className="bg-secondary-surface/40 p-2.5 rounded-xl border border-border-premium text-[11px] space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-muted-text text-[8px] uppercase tracking-wider font-bold">Leaving Gate:</span>
                  <span className="text-primary-text font-bold font-mono text-[9px] sm:text-[10px]">{new Date(selectedQR.out_date).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center border-t border-border-premium/50 pt-1.5">
                  <span className="text-muted-text text-[8px] uppercase tracking-wider font-bold">Reporting Back:</span>
                  <span className="text-primary-text font-bold font-mono text-[9px] sm:text-[10px]">{new Date(selectedQR.in_date).toLocaleString()}</span>
                </div>
              </div>

              {/* Reason description */}
              <div className="text-[11px]">
                <span className="text-muted-text text-[8px] uppercase tracking-wider font-bold block mb-0.5">Stated Purpose / Reason</span>
                <p className="bg-warm-accent/40 border border-amber-100/50 rounded-xl p-2.5 text-secondary-text font-medium italic text-[11px]">
                  "{selectedQR.reason}"
                </p>
              </div>

              {/* Clearance registry timeline */}
              <div className="pt-1.5 border-t border-border-premium">
                <span className="text-muted-text text-[8px] uppercase tracking-wider font-bold block mb-1.5">Gate Clearance Stamp Logs</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {/* Advisor */}
                  <div className={`flex flex-col items-center text-center p-1.5 rounded-lg border border-dashed text-[11px] ${
                    selectedQRAdvisorStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                  }`}>
                    {selectedQRAdvisorStamp ? (
                      <>
                        <CheckCircle className="text-emerald-600 mb-0.5" size={12} />
                        <span className="text-[8px] font-black text-emerald-800 uppercase tracking-widest leading-none">Advisor</span>
                        <span className="text-[7px] text-emerald-700 font-semibold truncate w-full max-w-[85px] mt-0.5" title={selectedQRAdvisorStamp.name}>
                          {selectedQRAdvisorStamp.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="w-3 h-3 rounded-full border border-dashed border-muted-text mb-0.5 animate-pulse" />
                        <span className="text-[8px] font-bold text-muted-text uppercase tracking-widest leading-none">Advisor</span>
                        <span className="text-[7px] text-muted-text font-medium mt-0.5">Pending</span>
                      </>
                    )}
                  </div>

                  {/* HOD */}
                  <div className={`flex flex-col items-center text-center p-1.5 rounded-lg border border-dashed text-[11px] ${
                    selectedQRHODStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                  }`}>
                    {selectedQRHODStamp ? (
                      <>
                        <CheckCircle className="text-emerald-600 mb-0.5" size={12} />
                        <span className="text-[8px] font-black text-emerald-800 uppercase tracking-widest leading-none">HOD</span>
                        <span className="text-[7px] text-emerald-700 font-semibold truncate w-full max-w-[85px] mt-0.5" title={selectedQRHODStamp.name}>
                          {selectedQRHODStamp.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="w-3 h-3 rounded-full border border-dashed border-muted-text mb-0.5 animate-pulse" />
                        <span className="text-[8px] font-bold text-muted-text uppercase tracking-widest leading-none">HOD</span>
                        <span className="text-[7px] text-muted-text font-medium mt-0.5">Pending</span>
                      </>
                    )}
                  </div>

                  {/* Warden */}
                  <div className={`flex flex-col items-center text-center p-1.5 rounded-lg border border-dashed text-[11px] ${
                    selectedQRWardenStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                  }`}>
                    {selectedQRWardenStamp ? (
                      <>
                        <CheckCircle className="text-emerald-600 mb-0.5" size={12} />
                        <span className="text-[8px] font-black text-emerald-800 uppercase tracking-widest leading-none">Warden</span>
                        <span className="text-[7px] text-emerald-700 font-semibold truncate w-full max-w-[85px] mt-0.5" title={selectedQRWardenStamp.name}>
                          {selectedQRWardenStamp.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="w-3 h-3 rounded-full border border-dashed border-muted-text mb-0.5 animate-pulse" />
                        <span className="text-[8px] font-bold text-muted-text uppercase tracking-widest leading-none">Warden</span>
                        <span className="text-[7px] text-muted-text font-medium mt-0.5">Pending</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Boarding pass ticket notched divisor */}
            <div className="relative h-4 flex items-center justify-between pointer-events-none bg-pure-white shrink-0">
              {/* Left notches cutout */}
              <div className="absolute -left-2.5 w-5 h-5 rounded-full bg-[#eaedf0] border-r border-border-premium z-10" />
              
              {/* Dashed separator */}
              <div className="w-full border-t-2 border-dashed border-border-premium mx-4" />
              
              {/* Right notches cutout */}
              <div className="absolute -right-2.5 w-5 h-5 rounded-full bg-[#eaedf0] border-l border-border-premium z-10" />
            </div>

            {/* Bottom Scannable Ticket Stub */}
            <div className="p-4 pt-1 bg-pure-white text-center space-y-2.5 shrink-0">
              <div className="bg-secondary-surface p-2.5 rounded-2xl w-fit mx-auto border border-border-premium shadow-inner">
                <div className="w-28 h-28 bg-pure-white flex flex-col items-center justify-center p-1.5 rounded-xl border border-border-premium shadow-sm">
                  <QRCode
                    value={selectedQR.qr_token}
                    size={80}
                    title="Scannable QR Outpass"
                  />
                  <span className="text-[8px] font-mono tracking-widest text-muted-text font-bold uppercase mt-1">{selectedQR.qr_token}</span>
                </div>
              </div>
              
              <p className="text-[9px] text-muted-text font-medium leading-normal px-2">
                Scan this QR code pass at the gate checkpoint for automatic exit/entry logging.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => handlePrintPass(selectedQR)}
                  className="flex-1 btn-premium btn-premium-primary text-xs !h-9 rounded-xl font-bold"
                >
                  Print Gate Ticket
                </button>
                <button
                  onClick={() => {
                    setSelectedQR(null);
                    setTiltStyle({});
                  }}
                  className="flex-1 btn-premium btn-premium-secondary text-xs !h-9 rounded-xl font-bold"
                >
                  Close Pass
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

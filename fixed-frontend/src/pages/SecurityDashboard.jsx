import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { LogOut, Search, CheckCircle, Navigation, RefreshCw, FileText, Check, Shield, Camera, CameraOff, QrCode } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { getErrorMessage } from "../utils/errorUtils";
import { showSuccessToast, useErrorState } from "../components/Toaster";
import Pagination from "../components/Pagination";

export default function SecurityDashboard({ token, userName, onLogout, apiUrl }) {
  const [tokenInput, setTokenInput] = useState("");
  const [outpass, setOutpass] = useState(null);
  const [selectedOutpass, setSelectedOutpass] = useState(null);

  const [, setError] = useErrorState();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // QR Scanner states
  const [showScanner, setShowScanner] = useState(false);
  const scannerRef = useRef(null);

  // History tab states
  const [activeTab, setActiveTab] = useState("lookup"); // "lookup" or "history"
  const [gateHistory, setGateHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyMeta, setHistoryMeta] = useState({ total: 0, totalPages: 0 });
  const [gateCounts, setGateCounts] = useState({ outsiders: 0, returned: 0 });

  const headers = { Authorization: `Bearer ${token}` };

  const outsidersList = gateHistory.filter(op => op.status === "Student Left");

  useEffect(() => {
    fetchGateHistory();
    fetchGateCounts();
  }, []);

  const fetchGateHistory = async (
    page = historyPage,
    pageSize = historyPageSize,
    status = activeTab === "outsiders" ? "Student Left" : activeTab === "history" ? "Student Returned" : undefined,
  ) => {
    setError("");
    setMessage("");
    try {
      const res = await axios.get(`${apiUrl}/api/outpass/my-requests`, {
        headers,
        params: { page, page_size: pageSize, status }
      });
      setGateHistory(res.data.items);
      setHistoryMeta({ total: res.data.total, totalPages: res.data.total_pages || res.data.totalPages });
    } catch (err) {
      console.error(err);
      setError("Failed to fetch gate activity logs.");
    }
  };

  const fetchGateCounts = async () => {
    try {
      const [outsiders, returned] = await Promise.all([
        axios.get(`${apiUrl}/api/outpass/my-requests`, {
          headers,
          params: { page: 1, page_size: 1, status: "Student Left" },
        }),
        axios.get(`${apiUrl}/api/outpass/my-requests`, {
          headers,
          params: { page: 1, page_size: 1, status: "Student Returned" },
        }),
      ]);
      setGateCounts({ outsiders: outsiders.data.total, returned: returned.data.total });
    } catch (err) {
      console.error("Failed to fetch gate activity counts", err);
    }
  };

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

  const getValidityStatus = (req) => {
    if (req.status === "Student Returned") {
      return { text: "CHECKED IN / USED", color: "bg-gray-100 text-gray-500 border-gray-200" };
    }
    if (req.status === "Student Left") {
      return { text: "CHECKED OUT / ACTIVE", color: "bg-purple-100 text-purple-700 border-purple-200" };
    }
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

  const performLookup = async (lookupToken) => {
    if (!lookupToken) return;
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await axios.get(`${apiUrl}/api/outpass/lookup`, {
        headers,
        params: { token: lookupToken.trim() },
      });
      setOutpass(res.data);
      showSuccessToast("Student outpass receipt successfully loaded.");
    } catch (err) {
      setError(getErrorMessage(err, "Outpass not found."));
      setOutpass(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = async (e) => {
    e.preventDefault();
    performLookup(tokenInput);
  };

  // QR Scanner lifecycle management
  useEffect(() => {
    let scannerInstance = null;

    if (showScanner) {
      setError("");
      setMessage("");
      
      const timer = setTimeout(() => {
        try {
          const html5QrCode = new Html5Qrcode("qr-reader");
          scannerInstance = html5QrCode;
          scannerRef.current = html5QrCode;

          html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 20,
              qrbox: (width, height) => {
                const size = Math.min(width, height) * 0.7;
                return { width: size, height: size };
              },
              formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ]
            },
            (decodedText) => {
              setTokenInput(decodedText);
              setShowScanner(false);
              performLookup(decodedText);
            },
            () => {}
          ).catch(err => {
            console.error("Failed to start camera:", err);
            setError("Failed to access camera: Make sure you have given permission.");
            setShowScanner(false);
          });
        } catch (setupError) {
          console.error("Scanner setup failed:", setupError);
          setError("Failed to initialize scanner: " + setupError.message);
          setShowScanner(false);
        }
      }, 150);

      return () => {
        clearTimeout(timer);
        if (scannerInstance && scannerInstance.isScanning) {
          scannerInstance.stop().catch(err => console.error("Error stopping scanner:", err));
        }
      };
    }
  }, [showScanner]);

  const handleMarkGate = async (action) => {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await axios.post(
        `${apiUrl}/api/outpass/mark-gate`,
        { outpassId: outpass.qr_token || outpass.id, action },
        { headers }
      );
      setMessage(`Gate registration successful: Student status marked as ${res.data.status}`);
      setOutpass(res.data);
      setTokenInput("");
      fetchGateHistory();
      fetchGateCounts();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to submit gate action."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen premium-bg p-4 sm:p-6 font-sans relative">
      <div className="absolute inset-0 noise-overlay pointer-events-none z-0" />

      <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8 z-10 relative">
        {/* Top Navbar */}
        <header className="flex items-center justify-between py-4 border-b border-border-premium">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pure-white flex items-center justify-center border border-border-premium shadow-sm">
              <Shield size={18} className="text-primary-text" />
            </div>
            <div>
              <span className="text-[10px] text-muted-text uppercase font-bold tracking-widest">Warden Gate</span>
              <h2 className="text-base font-bold text-primary-text leading-none">Security Desk</h2>
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
              className="btn-premium btn-premium-secondary !h-10 text-xs gap-1.5"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </header>

          {/* Dashboard tabs controller */}
        <div className="flex flex-col gap-4">
          <div className="bg-secondary-surface p-1 rounded-xl flex gap-1 border border-border-premium">
            <button
              onClick={() => setActiveTab("lookup")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                activeTab === "lookup"
                  ? "bg-pure-white text-primary-text shadow-sm"
                  : "text-muted-text hover:text-primary-text"
              }`}
            >
              Gate Verification Lookup
            </button>
            <button
              onClick={() => {
                setActiveTab("outsiders");
                setHistoryPage(1);
                fetchGateHistory(1, historyPageSize, "Student Left");
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                activeTab === "outsiders"
                  ? "bg-pure-white text-primary-text shadow-sm"
                  : "text-muted-text hover:text-primary-text"
              }`}
            >
              Outsiders List ({gateCounts.outsiders})
            </button>
            <button
              onClick={() => {
                setActiveTab("history");
                setHistoryPage(1);
                fetchGateHistory(1, historyPageSize, "Student Returned");
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                activeTab === "history"
                  ? "bg-pure-white text-primary-text shadow-sm"
                  : "text-muted-text hover:text-primary-text"
              }`}
            >
              Gate logs ({gateCounts.returned})
            </button>
          </div>
        </div>

        {/* Messaging area */}
        {message && (
          <div className="p-4 bg-success-surface border border-emerald-200/50 text-emerald-800 text-sm rounded-2xl flex items-center gap-2">
            <CheckCircle size={18} className="shrink-0 text-emerald-600" />
            <span className="font-semibold">{message}</span>
          </div>
        )}

        {/* Active Panel View */}
        {activeTab === "lookup" && (
          <div className="space-y-6">
            {/* Token Lookup card */}
            <section className="card-premium p-6 bg-pure-white border border-border-premium">
              <h3 className="text-base font-bold text-primary-text mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Search size={18} className="text-primary-text" />
                  <span>Search Approved Passes</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowScanner(!showScanner)}
                  className={`btn-premium text-xs gap-1.5 px-3 py-1.5 !h-auto rounded-lg font-bold border transition-colors ${
                    showScanner
                      ? "bg-red-50 hover:bg-red-100 text-red-600 border-red-200"
                      : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                  }`}
                >
                  {showScanner ? (
                    <>
                      <CameraOff size={14} />
                      <span>Stop Camera</span>
                    </>
                  ) : (
                    <>
                      <Camera size={14} />
                      <span>Scan QR Pass</span>
                    </>
                  )}
                </button>
              </h3>

              {showScanner && (
                <div className="mb-4 p-4 bg-secondary-surface rounded-2xl border border-border-premium text-center">
                  <div className="text-[10px] text-muted-text uppercase font-bold tracking-widest mb-3 flex items-center justify-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                    <span>Camera scanning active</span>
                  </div>
                  <div
                    id="qr-reader"
                    className="w-full max-w-[320px] aspect-square mx-auto rounded-xl overflow-hidden border border-border-premium bg-black relative shadow-inner"
                  />
                </div>
              )}

              <form onSubmit={handleLookup} className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Enter QR Token or Roll Number"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="flex-1 input-premium font-mono uppercase tracking-wider text-xs"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-premium btn-premium-primary text-xs !h-52px whitespace-nowrap px-4"
                >
                  Verify
                </button>
              </form>
            </section>

            {/* Receipt Output Panel */}
            {outpass && (
              <section className="card-premium bg-pure-white border border-border-premium overflow-hidden hover:shadow-lg transition-all duration-300">
                <div className="bg-secondary-surface p-4 border-b border-border-premium text-center">
                  <span className="text-[10px] font-bold uppercase text-muted-text tracking-widest block">Outpass Security Receipt</span>
                  <span className="text-lg font-bold text-primary-text uppercase tracking-wider">{outpass.student_name}</span>
                </div>

                <div className="p-6 space-y-4 text-xs font-medium text-secondary-text">
                  <div className="flex justify-between border-b border-border-premium pb-2">
                    <span className="text-muted-text uppercase text-[10px]">Roll Number:</span>
                    <span className="text-primary-text font-mono font-semibold">{outpass.roll_number}</span>
                  </div>
                  <div className="flex justify-between border-b border-border-premium pb-2">
                    <span className="text-muted-text uppercase text-[10px]">Hostel / Room:</span>
                    <span className="text-primary-text font-semibold">{outpass.hostel_name || "N/A"} - Room {outpass.room || "N/A"}</span>
                  </div>
                  <div className="flex justify-between border-b border-border-premium pb-2">
                    <span className="text-muted-text uppercase text-[10px]">Destination:</span>
                    <span className="text-primary-text font-semibold">{outpass.destination}</span>
                  </div>
                  <div className="flex justify-between border-b border-border-premium pb-2">
                    <span className="text-muted-text uppercase text-[10px]">Exit Scheduled:</span>
                    <span className="text-primary-text font-semibold">{new Date(outpass.out_date).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-b border-border-premium pb-2">
                    <span className="text-muted-text uppercase text-[10px]">Return Scheduled:</span>
                    <span className="text-primary-text font-semibold">{new Date(outpass.in_date).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-b border-border-premium pb-2">
                    <span className="text-muted-text uppercase text-[10px]">QR Token ID:</span>
                    <span className="text-emerald-700 font-mono font-bold tracking-widest">{outpass.qr_token}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-muted-text uppercase text-[10px]">Current Status:</span>
                    <span className="px-3 py-1 bg-cool-accent text-primary-text rounded-full border border-border-premium font-semibold text-[11px]">
                      {outpass.status}
                    </span>
                  </div>

                  {/* Actions Trigger Box */}
                  <div className="pt-6 border-t border-border-premium">
                    {outpass.status === "Approved" && (
                      <button
                        onClick={() => handleMarkGate("EXIT")}
                        className="w-full btn-premium btn-premium-primary text-xs gap-1.5 justify-center shadow-md"
                      >
                        <Navigation size={14} className="rotate-90" />
                        <span>MARK EXIT (Check-Out Student)</span>
                      </button>
                    )}
                    {outpass.status === "Student Left" && (
                      <button
                        onClick={() => handleMarkGate("ENTRY")}
                        className="w-full btn-premium btn-premium-primary text-xs gap-1.5 justify-center shadow-md"
                      >
                        <Check size={14} />
                        <span>MARK ENTRY (Check-In Student)</span>
                      </button>
                    )}
                    {!["Approved", "Student Left"].includes(outpass.status) && (
                      <div className="p-4 bg-secondary-surface border border-border-premium text-muted-text text-center rounded-2xl text-[11px] font-semibold">
                        No check-in or check-out triggers available. Status: {outpass.status}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Outsiders view list */}
        {activeTab === "outsiders" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-border-premium">
              <h3 className="text-base font-bold text-primary-text flex items-center gap-2">
                <Navigation size={18} className="text-secondary-text rotate-90" />
                <span>Outsiders List (Checked-Out Students)</span>
              </h3>
              <button
                onClick={fetchGateHistory}
                className="btn-premium btn-premium-secondary !h-9 !w-9 !p-0"
                title="Refresh list"
              >
                <RefreshCw size={14} className="icon-hover-rotate" />
              </button>
            </div>

            {outsidersList.length === 0 ? (
              <div className="card-premium p-8 bg-pure-white text-center text-muted-text text-xs">
                No students are currently registered outside campus.
              </div>
            ) : (
              <div className="space-y-4">
                {outsidersList.map((op) => (
                  <div key={op.id} className="card-premium p-5 bg-pure-white border border-border-premium hover:shadow-sm transition-all duration-300">
                    <div className="flex justify-between items-center mb-3 border-b border-border-premium pb-2">
                      <span className="font-bold text-primary-text text-sm">{op.student_name}</span>
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold border bg-purple-50 text-purple-700 border-purple-100">
                        OUTSIDE
                      </span>
                    </div>

                    <div className="space-y-2 text-xs font-semibold text-secondary-text mb-4">
                      <div className="flex justify-between">
                        <span className="text-muted-text uppercase text-[9px]">Roll Number:</span>
                        <span className="text-primary-text font-mono">{op.roll_number}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-text uppercase text-[9px]">Hostel / Room:</span>
                        <span className="text-primary-text">{op.hostel_name || "N/A"} - Room {op.room || "N/A"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-text uppercase text-[9px]">Destination:</span>
                        <span className="text-primary-text">{op.destination}</span>
                      </div>
                      {op.exit_time && (
                        <div className="flex justify-between">
                          <span className="text-muted-text uppercase text-[9px]">Checked Out At:</span>
                          <span className="text-purple-700 font-mono">{new Date(op.exit_time).toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-text uppercase text-[9px]">Expected Return:</span>
                        <span className="text-red-600 font-mono">{new Date(op.in_date).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedOutpass(op)}
                        className="flex-1 btn-premium btn-premium-secondary text-xs gap-1.5 justify-center py-2 rounded-xl font-bold flex items-center"
                      >
                        <QrCode size={14} />
                        <span>View Ticket</span>
                      </button>
                      <button
                        onClick={async () => {
                          setError("");
                          setMessage("");
                          setLoading(true);
                          try {
                            await axios.post(
                              `${apiUrl}/api/outpass/mark-gate`,
                              { outpassId: op.qr_token || op.id, action: "ENTRY" },
                              { headers }
                            );
                            setMessage(`Student ${op.student_name} successfully checked back in.`);
                            fetchGateHistory();
                            fetchGateCounts();
                          } catch (err) {
                            setError(getErrorMessage(err, "Failed to submit check-in."));
                          } finally {
                            setLoading(false);
                          }
                        }}
                        disabled={loading}
                        className="flex-1 btn-premium btn-premium-primary text-xs gap-1.5 justify-center py-2 rounded-xl font-bold flex items-center"
                      >
                        <Check size={14} />
                        <span>Mark Return</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Pagination
              page={historyPage}
              pageSize={historyPageSize}
              total={historyMeta.total}
              totalPages={historyMeta.totalPages}
              onPageChange={(page) => { setHistoryPage(page); fetchGateHistory(page); }}
              onPageSizeChange={(size) => { setHistoryPageSize(size); setHistoryPage(1); fetchGateHistory(1, size); }}
            />
          </div>
        )}

        {/* Logs view list */}
        {activeTab === "history" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-border-premium">
              <h3 className="text-base font-bold text-primary-text flex items-center gap-2">
                <FileText size={18} className="text-secondary-text" />
                <span>Gate Logs Archive (Returned Students)</span>
              </h3>
              <button
                onClick={fetchGateHistory}
                className="btn-premium btn-premium-secondary !h-9 !w-9 !p-0"
                title="Refresh logs"
              >
                <RefreshCw size={14} className="icon-hover-rotate" />
              </button>
            </div>

            {gateHistory.filter(op => op.status === "Student Returned").length === 0 ? (
              <div className="card-premium p-8 bg-pure-white text-center text-muted-text text-xs">
                No checkout or checkin logs found.
              </div>
            ) : (
              <div className="space-y-4">
                {gateHistory.filter(op => op.status === "Student Returned").map((op) => (
                  <div key={op.id} className="card-premium p-5 bg-pure-white border border-border-premium hover:shadow-sm transition-all duration-300">
                    <div className="flex justify-between items-center mb-3 border-b border-border-premium pb-2">
                      <span className="font-bold text-primary-text text-sm">{op.student_name}</span>
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                        op.status === "Student Returned"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                          : "bg-purple-50 text-purple-700 border-purple-100"
                      }`}>
                        {op.status}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs font-semibold text-secondary-text">
                      <div className="flex justify-between">
                        <span className="text-muted-text uppercase text-[9px]">Roll Number:</span>
                        <span className="text-primary-text font-mono">{op.roll_number}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-text uppercase text-[9px]">Destination:</span>
                        <span className="text-primary-text">{op.destination}</span>
                      </div>
                      {op.exit_time && (
                        <div className="flex justify-between">
                          <span className="text-muted-text uppercase text-[9px]">Check-Out Time:</span>
                          <span className="text-purple-700 font-mono">{new Date(op.exit_time).toLocaleString()}</span>
                        </div>
                      )}
                      {op.entry_time && (
                        <div className="flex justify-between">
                          <span className="text-muted-text uppercase text-[9px]">Check-In Time:</span>
                          <span className="text-emerald-700 font-mono">{new Date(op.entry_time).toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-text uppercase text-[9px]">Pass Code:</span>
                        <span className="font-mono text-primary-text">{op.qr_token}</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border-premium flex justify-end">
                      <button
                        onClick={() => setSelectedOutpass(op)}
                        className="btn-premium btn-premium-secondary text-xs gap-1.5 py-1.5 px-3 rounded-xl font-bold flex items-center"
                      >
                        <QrCode size={12} />
                        <span>View Details / Ticket</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Outpass Details Modal Popup for Security Verification */}
      {selectedOutpass && (() => {
        const validity = getValidityStatus(selectedOutpass);
        const advisorStamp = getApprovalStamp(selectedOutpass.history, "advisor");
        const wardenStamp = getApprovalStamp(selectedOutpass.history, "warden");
        const hodStamp = getApprovalStamp(selectedOutpass.history, "hod");

        return (
          <div className="fixed inset-0 bg-primary-bg/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-50 transition-all duration-300">
            <div className="bg-pure-white border border-border-premium rounded-[28px] max-w-md w-full overflow-hidden shadow-2xl relative text-left max-h-[85vh] flex flex-col my-auto">
              {/* Top Banner */}
              <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-5 py-3 flex justify-between items-center relative shrink-0">
                <div className="flex items-center gap-2">
                  <QrCode size={16} className="text-white/90" />
                  <span className="text-[10px] font-black tracking-widest uppercase">Security Verification Stub</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[8px] sm:text-[9px] font-bold bg-white/20 uppercase tracking-wide border border-white/10">
                  {validity?.text}
                </span>
              </div>
              
              {/* Details Body */}
              <div className="p-4 sm:p-5 space-y-3.5 pb-4 overflow-y-auto flex-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-cool-accent border border-border-premium flex items-center justify-center text-primary-text font-black text-base">
                    {selectedOutpass.student_name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-primary-text leading-tight">{selectedOutpass.student_name}</h4>
                    <p className="text-[9px] sm:text-[10px] text-muted-text font-mono font-bold uppercase tracking-wider">{selectedOutpass.roll_number}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-[11px]">
                  <div className="bg-secondary-surface/40 p-2.5 rounded-xl border border-border-premium">
                    <span className="text-muted-text text-[8px] uppercase tracking-wider block font-bold mb-0.5">Hostel Room</span>
                    <span className="text-primary-text font-bold block">{selectedOutpass.hostel_name || "N/A"}</span>
                    <span className="text-muted-text text-[9px] block mt-0.5">Room {selectedOutpass.room || "N/A"}</span>
                  </div>
                  <div className="bg-secondary-surface/40 p-2.5 rounded-xl border border-border-premium">
                    <span className="text-muted-text text-[8px] uppercase tracking-wider block font-bold mb-0.5">Destination</span>
                    <span className="text-primary-text font-bold block truncate" title={selectedOutpass.destination}>{selectedOutpass.destination}</span>
                    <span className="text-muted-text text-[9px] block mt-0.5">Authorized Outpass</span>
                  </div>
                </div>

                <div className="bg-secondary-surface/40 p-2.5 rounded-xl border border-border-premium text-[11px] space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-text text-[8px] uppercase tracking-wider font-bold">Leaving Gate:</span>
                    <span className="text-primary-text font-bold font-mono text-[9px] sm:text-[10px]">{new Date(selectedOutpass.out_date).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-border-premium/50 pt-1.5">
                    <span className="text-muted-text text-[8px] uppercase tracking-wider font-bold">Reporting Back:</span>
                    <span className="text-primary-text font-bold font-mono text-[9px] sm:text-[10px]">{new Date(selectedOutpass.in_date).toLocaleString()}</span>
                  </div>
                </div>

                {selectedOutpass.exit_time && (
                  <div className="bg-purple-50/50 border border-purple-100/50 p-2.5 rounded-xl text-[11px] flex justify-between items-center">
                    <span className="text-purple-700 font-bold uppercase text-[8px]">Actual Exit Check-Out:</span>
                    <span className="text-purple-900 font-bold font-mono text-[9px] sm:text-[10px]">{new Date(selectedOutpass.exit_time).toLocaleString()}</span>
                  </div>
                )}
                {selectedOutpass.entry_time && (
                  <div className="bg-emerald-50/50 border border-emerald-100/50 p-2.5 rounded-xl text-[11px] flex justify-between items-center">
                    <span className="text-emerald-700 font-bold uppercase text-[8px]">Actual Return Check-In:</span>
                    <span className="text-emerald-900 font-bold font-mono text-[9px] sm:text-[10px]">{new Date(selectedOutpass.entry_time).toLocaleString()}</span>
                  </div>
                )}

                <div className="pt-1.5 border-t border-border-premium">
                  <span className="text-muted-text text-[8px] uppercase tracking-wider font-bold block mb-1.5">Gate Clearance Stamp Logs</span>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className={`flex flex-col items-center p-1.5 rounded-lg border border-dashed text-[11px] ${
                      advisorStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                    }`}>
                      <CheckCircle className={advisorStamp ? "text-emerald-600 mb-0.5" : "text-muted-text/30 mb-0.5"} size={12} />
                      <span className="text-[8px] font-black uppercase tracking-widest leading-none">Advisor</span>
                      <span className="text-[7px] font-semibold mt-0.5 truncate w-full max-w-[85px]" title={advisorStamp ? advisorStamp.name : "Pending"}>
                        {advisorStamp ? advisorStamp.name : "Pending"}
                      </span>
                    </div>

                    <div className={`flex flex-col items-center p-1.5 rounded-lg border border-dashed text-[11px] ${
                      hodStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                    }`}>
                      <CheckCircle className={hodStamp ? "text-emerald-600 mb-0.5" : "text-muted-text/30 mb-0.5"} size={12} />
                      <span className="text-[8px] font-black uppercase tracking-widest leading-none">HOD</span>
                      <span className="text-[7px] font-semibold mt-0.5 truncate w-full max-w-[85px]" title={hodStamp ? hodStamp.name : "Pending"}>
                        {hodStamp ? hodStamp.name : "Pending"}
                      </span>
                    </div>

                    <div className={`flex flex-col items-center p-1.5 rounded-lg border border-dashed text-[11px] ${
                      wardenStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                    }`}>
                      <CheckCircle className={wardenStamp ? "text-emerald-600 mb-0.5" : "text-muted-text/30 mb-0.5"} size={12} />
                      <span className="text-[8px] font-black uppercase tracking-widest leading-none">Warden</span>
                      <span className="text-[7px] font-semibold mt-0.5 truncate w-full max-w-[85px]" title={wardenStamp ? wardenStamp.name : "Pending"}>
                        {wardenStamp ? wardenStamp.name : "Pending"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Close Button */}
              <div className="p-4 pt-2 bg-pure-white border-t border-border-premium shrink-0">
                <button
                  onClick={() => setSelectedOutpass(null)}
                  className="w-full btn-premium btn-premium-primary text-xs font-bold rounded-xl !h-10"
                >
                  Close Verification
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

import React, { useState, useEffect } from "react";
import axios from "axios";
import { LogOut, RefreshCw, Check, X, ShieldAlert, Award, FileText, CheckCircle, Activity, Download } from "lucide-react";
import { getErrorMessage } from "../utils/errorUtils";
import { showSuccessToast, useErrorState } from "../components/Toaster";
import Pagination from "../components/Pagination";

export default function ApproverDashboard({ token, role, userName, onLogout, apiUrl }) {
  const [requests, setRequests] = useState([]);
  const [, setError] = useErrorState();
  
  // History states
  const [historyRequests, setHistoryRequests] = useState([]);
  const [pendingPage, setPendingPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pendingMeta, setPendingMeta] = useState({ total: 0, totalPages: 0 });
  const [historyMeta, setHistoryMeta] = useState({ total: 0, totalPages: 0 });
  const [wardenSummary, setWardenSummary] = useState([]);
  const [activeTab, setActiveTab] = useState("pending"); // "pending" or "history"
  const [selectedOutpass, setSelectedOutpass] = useState(null);

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

  // States for rejection dialog modal
  const [rejoiningId, setRejoiningId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [comments, setComments] = useState("");

  const [actionLoading, setActionLoading] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchWardenSummary = async () => {
    if (role !== "warden") return;
    try {
      const res = await axios.get(`${apiUrl}/api/warden/summary`, { headers });
      setWardenSummary(res.data || []);
    } catch (err) {
      console.error(err);
      setWardenSummary([]);
    }
  };

  const handleDownloadReport = async () => {
    setError("");
    try {
      const response = await axios.get(`${apiUrl}/api/reports/excel/daily`, {
        headers,
        responseType: "blob"
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const today = new Date().toISOString().split("T")[0];
      link.setAttribute("download", `outpass_activity_${today}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showSuccessToast("Gate Activity report downloaded successfully!");
    } catch (err) {
      console.error("Excel download failed:", err);
      setError("Failed to download daily Excel report. Make sure there are gate activities recorded.");
    }
  };

  const fetchPending = async (page = pendingPage, size = pageSize) => {
    try {
      const res = await axios.get(`${apiUrl}/api/outpass/pending`, { headers, params: { page, page_size: size } });
      setRequests(res.data.items);
      setPendingMeta({ total: res.data.total, totalPages: res.data.total_pages || res.data.totalPages });
    } catch (err) {
      console.error(err);
      setError("Failed to fetch pending outpass requests.");
    }
  };

  const fetchHistory = async (page = historyPage, size = pageSize) => {
    try {
      const res = await axios.get(`${apiUrl}/api/outpass/my-requests`, {
        headers,
        params: { page, page_size: size, history_only: true }
      });
      setHistoryRequests(res.data.items);
      setHistoryMeta({ total: res.data.total, totalPages: res.data.total_pages || res.data.totalPages });
    } catch (err) {
      console.error(err);
      setError("Failed to fetch clearance history.");
    }
  };

  useEffect(() => {
    fetchPending();
    if (role === "warden") {
      fetchWardenSummary();
    }
  }, [role]);

  const handleApprove = async (id) => {
    if (actionLoading) return;
    setError("");
    setActionLoading(id);
    try {
      await axios.post(`${apiUrl}/api/outpass/${id}/approve`, { comments: comments || `Approved by ${role}` }, { headers });
      showSuccessToast("Outpass approved successfully.");
      setComments("");
      await Promise.all([fetchPending(), fetchHistory()]);
    } catch (err) {
      if (err.response?.status === 409) {
        setError("This request was already actioned (possibly by someone else, or a duplicate click). Refreshing list.");
        fetchPending();
      } else {
        setError(getErrorMessage(err, "Approval action failed."));
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (e) => {
    e.preventDefault();
    if (!rejectionReason || actionLoading) return;
    setError("");
    setActionLoading(rejoiningId);
    try {
      await axios.post(
        `${apiUrl}/api/outpass/${rejoiningId}/reject`,
        { rejection_reason: rejectionReason },
        { headers }
      );
      showSuccessToast("Outpass rejected successfully.");
      setRejectionReason("");
      setRejoiningId(null);
      await Promise.all([fetchPending(), fetchHistory()]);
    } catch (err) {
      if (err.response?.status === 409) {
        setError("This request was already actioned (possibly by someone else, or a duplicate click). Refreshing list.");
        fetchPending();
      } else {
        setError(getErrorMessage(err, "Rejection action failed."));
      }
    } finally {
      setActionLoading(null);
    }
  };

  const getDashboardColorTheme = () => {
    switch (role) {
      case "advisor": return { label: "Academic Advisor", accent: "text-blue-600 bg-blue-50 border-blue-200/50" };
      case "warden": return { label: "Hostel Warden", accent: "text-indigo-600 bg-indigo-50 border-indigo-200/50" };
      case "hod": return { label: "Department HOD", accent: "text-emerald-600 bg-emerald-50 border-emerald-200/50" };
      default: return { label: role, accent: "text-gray-600 bg-gray-50 border-gray-200" };
    }
  };

  const theme = getDashboardColorTheme();

  return (
    <div className="min-h-screen premium-bg p-6 font-sans relative">
      <div className="absolute inset-0 noise-overlay pointer-events-none z-0" />

      <div className="max-w-4xl mx-auto space-y-8 z-10 relative">
        {/* Top Navbar */}
        <header className="flex items-center justify-between py-4 border-b border-border-premium">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pure-white flex items-center justify-center border border-border-premium shadow-sm">
              <Award size={18} className="text-primary-text" />
            </div>
            <div>
              <span className="text-[10px] text-muted-text uppercase font-bold tracking-widest">Clearance Desk</span>
              <h2 className="text-base font-bold text-primary-text leading-none capitalize">{role} Portal</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {userName && (
              <span className="hidden sm:inline text-xs font-semibold text-muted-text">
                Welcome, <span className="text-primary-text">{userName}</span>
              </span>
            )}
            <button
              onClick={handleDownloadReport}
              className="btn-premium btn-premium-secondary text-xs gap-1.5 py-1.5 px-3 rounded-xl font-bold flex items-center"
              title="Download daily gate activity report in Excel format"
            >
              <Download size={14} className="text-emerald-600" />
              <span className="hidden sm:inline">Excel Report</span>
            </button>

            <button
              onClick={onLogout}
              className="btn-premium btn-premium-secondary !h-10 text-xs gap-1.5"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Role Identity Tag */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full border font-extrabold text-xs tracking-wide uppercase ${theme.accent}`}>
              {theme.label}
            </span>
            <span className="text-xs text-muted-text font-semibold">Clearance Authority</span>
          </div>

          <div className="bg-secondary-surface p-1 rounded-xl flex gap-1 border border-border-premium">
            <button
              onClick={() => {
                setActiveTab("pending");
                fetchPending();
              }}
              className={`py-1.5 px-4 rounded-lg text-xs font-bold transition-all duration-200 ${
                activeTab === "pending"
                  ? "bg-pure-white text-primary-text shadow-sm"
                  : "text-muted-text hover:text-primary-text"
              }`}
            >
              Pending Approvals ({requests.length})
            </button>
            <button
              onClick={() => {
                setActiveTab("history");
                fetchHistory();
              }}
              className={`py-1.5 px-4 rounded-lg text-xs font-bold transition-all duration-200 ${
                activeTab === "history"
                  ? "bg-pure-white text-primary-text shadow-sm"
                  : "text-muted-text hover:text-primary-text"
              }`}
            >
              Clearance History ({historyRequests.length})
            </button>
          </div>
        </div>

        {role === "warden" && wardenSummary.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {wardenSummary.map((hostel) => (
              <div key={hostel.hostel_name || "assigned-hostel"} className="card-premium bg-pure-white border border-border-premium p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-text font-bold">Assigned Hostel</span>
                  <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase">
                    {hostel.hostel_name || "Unassigned"}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-text">Currently in hostel</span>
                    <span className="text-base font-black text-primary-text">{hostel.resident_count}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-text">Capacity</span>
                    <span className="font-semibold text-primary-text">{hostel.capacity}</span>
                  </div>
                  <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.min(100, ((hostel.resident_count || 0) / (hostel.capacity || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main Panel Content */}
        {activeTab === "pending" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center pb-2 border-b border-border-premium">
              <h3 className="text-base font-bold text-primary-text flex items-center gap-2">
                <Activity size={18} className="text-secondary-text" />
                <span>Pending Outpass Requests</span>
              </h3>
              <button
                onClick={fetchPending}
                className="btn-premium btn-premium-secondary !h-9 !w-9 !p-0"
                title="Refresh requests"
              >
                <RefreshCw size={14} className="icon-hover-rotate" />
              </button>
            </div>

            {requests.length === 0 ? (
              <div className="card-premium p-12 bg-pure-white text-center text-muted-text space-y-3">
                <CheckCircle size={36} className="mx-auto text-emerald-500/40" />
                <p className="text-sm font-semibold">No pending requests requiring your clearance.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {requests.map((req) => (
                  <div key={req.id} className="card-premium bg-pure-white border border-border-premium p-6 flex flex-col justify-between hover:shadow-lg transition-all duration-300">
                    <div className="space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[10px] text-muted-text font-bold uppercase tracking-wider block">Student</span>
                          <h4 className="text-base font-bold text-primary-text">{req.student_name}</h4>
                          <span className="text-xs font-mono font-semibold text-secondary-text">Roll: {req.roll_number}</span>
                        </div>
                        <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-bold">
                          {req.status}
                        </span>
                      </div>

                      <div className="space-y-2 text-xs text-secondary-text bg-secondary-surface/40 p-4 rounded-2xl border border-border-premium">
                        <div className="flex justify-between">
                          <span className="text-muted-text uppercase text-[9px]">Destination:</span>
                          <span className="font-bold text-primary-text">{req.destination}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-text uppercase text-[9px]">Reason:</span>
                          <span className="font-semibold text-primary-text truncate max-w-[180px]" title={req.reason}>{req.reason}</span>
                        </div>
                        <div className="flex justify-between border-t border-border-premium/50 pt-2">
                          <span className="text-muted-text uppercase text-[9px]">Out Date:</span>
                          <span className="font-mono text-primary-text">{new Date(req.out_date).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-text uppercase text-[9px]">In Date:</span>
                          <span className="font-mono text-primary-text">{new Date(req.in_date).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-6 mt-6 border-t border-border-premium space-y-3">
                      <input
                        type="text"
                        placeholder="Add optional notes / comments..."
                        value={comments}
                        onChange={(e) => setComments(e.target.value)}
                        className="input-premium text-xs"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={() => setRejoiningId(req.id)}
                          disabled={actionLoading === req.id}
                          className="flex-1 btn-premium bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5"
                        >
                          <X size={14} />
                          <span>Reject</span>
                        </button>
                        <button
                          onClick={() => handleApprove(req.id)}
                          disabled={actionLoading === req.id}
                          className="flex-1 btn-premium btn-premium-primary text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5"
                        >
                          <Check size={14} />
                          <span>Approve</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Pagination
              page={pendingPage}
              pageSize={pageSize}
              total={pendingMeta.total}
              totalPages={pendingMeta.totalPages}
              onPageChange={(page) => { setPendingPage(page); fetchPending(page); }}
              onPageSizeChange={(size) => { setPageSize(size); setPendingPage(1); fetchPending(1, size); }}
            />
          </div>
        )}

        {/* Clearance History Tab */}
        {activeTab === "history" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center pb-2 border-b border-border-premium">
              <h3 className="text-base font-bold text-primary-text flex items-center gap-2">
                <FileText size={18} className="text-secondary-text" />
                <span>Actioned Outpass Records</span>
              </h3>
              <button
                onClick={fetchHistory}
                className="btn-premium btn-premium-secondary !h-9 !w-9 !p-0"
                title="Refresh history"
              >
                <RefreshCw size={14} className="icon-hover-rotate" />
              </button>
            </div>

            {historyRequests.length === 0 ? (
              <div className="card-premium p-12 bg-pure-white text-center text-muted-text space-y-2">
                <p className="text-sm font-semibold">No clearance history records found.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {historyRequests.map((req) => (
                  <div key={req.id} className="card-premium p-5 bg-pure-white border border-border-premium flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:shadow-md transition-all">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-bold text-primary-text text-sm">{req.student_name}</span>
                        <span className="text-xs font-mono text-muted-text">({req.roll_number})</span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          req.status.includes("Approved") || req.status.includes("Left") || req.status.includes("Returned")
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <p className="text-xs text-secondary-text font-medium">
                        Destination: <span className="font-bold">{req.destination}</span> • Reason: {req.reason}
                      </p>
                    </div>

                    <button
                      onClick={() => setSelectedOutpass(req)}
                      className="btn-premium btn-premium-secondary text-xs font-bold py-1.5 px-3 rounded-xl flex items-center gap-1.5 shrink-0"
                    >
                      <FileText size={14} />
                      <span>View Details</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Pagination
              page={historyPage}
              pageSize={pageSize}
              total={historyMeta.total}
              totalPages={historyMeta.totalPages}
              onPageChange={(page) => { setHistoryPage(page); fetchHistory(page); }}
              onPageSizeChange={(size) => { setPageSize(size); setHistoryPage(1); fetchHistory(1, size); }}
            />
          </div>
        )}
      </div>

      {/* Rejection Reason Modal */}
      {rejoiningId && (
        <div className="fixed inset-0 bg-primary-bg/75 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-pure-white border border-border-premium rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h4 className="text-base font-bold text-primary-text flex items-center gap-2">
              <ShieldAlert size={18} className="text-red-500" />
              <span>Provide Rejection Reason</span>
            </h4>
            <form onSubmit={handleReject} className="space-y-4">
              <textarea
                required
                rows={3}
                placeholder="State the rationale for declining leave authorization..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="input-premium text-xs w-full"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setRejoiningId(null);
                    setRejectionReason("");
                  }}
                  className="btn-premium btn-premium-secondary text-xs px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === rejoiningId}
                  className="btn-premium bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-xl"
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details Modal Popup */}
      {selectedOutpass && (() => {
        const advisorStamp = getApprovalStamp(selectedOutpass.history, "advisor");
        const wardenStamp = getApprovalStamp(selectedOutpass.history, "warden");
        const hodStamp = getApprovalStamp(selectedOutpass.history, "hod");

        return (
          <div className="fixed inset-0 bg-primary-bg/75 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <div className="bg-pure-white border border-border-premium rounded-[32px] max-w-md w-full p-6 space-y-4 shadow-2xl text-left">
              <div className="flex justify-between items-center border-b border-border-premium pb-3">
                <div>
                  <h4 className="text-base font-bold text-primary-text">{selectedOutpass.student_name}</h4>
                  <span className="text-xs font-mono font-semibold text-muted-text">Roll: {selectedOutpass.roll_number}</span>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-cool-accent border border-border-premium">
                  {selectedOutpass.status}
                </span>
              </div>

              <div className="space-y-2 text-xs text-secondary-text font-medium">
                <div className="flex justify-between">
                  <span className="text-muted-text uppercase text-[9px]">Destination:</span>
                  <span className="font-bold text-primary-text">{selectedOutpass.destination}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-text uppercase text-[9px]">Reason:</span>
                  <span className="font-semibold text-primary-text">{selectedOutpass.reason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-text uppercase text-[9px]">Out Date:</span>
                  <span className="font-mono text-primary-text">{new Date(selectedOutpass.out_date).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-text uppercase text-[9px]">In Date:</span>
                  <span className="font-mono text-primary-text">{new Date(selectedOutpass.in_date).toLocaleString()}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-border-premium">
                <span className="text-muted-text text-[9px] uppercase tracking-wider font-bold block mb-2">Gate Clearance Audit Stamps</span>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className={`flex flex-col items-center p-2 rounded-lg border border-dashed text-xs ${
                    advisorStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                  }`}>
                    <CheckCircle className={advisorStamp ? "text-emerald-600 mb-1" : "text-muted-text/30 mb-1"} size={14} />
                    <span className="text-[9px] font-black uppercase tracking-widest leading-none">Advisor</span>
                    <span className="text-[8px] font-semibold mt-1 truncate w-full max-w-[85px]" title={advisorStamp ? advisorStamp.name : "Pending"}>
                      {advisorStamp ? advisorStamp.name : "Pending"}
                    </span>
                  </div>

                  <div className={`flex flex-col items-center p-2 rounded-lg border border-dashed text-xs ${
                    hodStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                  }`}>
                    <CheckCircle className={hodStamp ? "text-emerald-600 mb-1" : "text-muted-text/30 mb-1"} size={14} />
                    <span className="text-[9px] font-black uppercase tracking-widest leading-none">HOD</span>
                    <span className="text-[8px] font-semibold mt-1 truncate w-full max-w-[85px]" title={hodStamp ? hodStamp.name : "Pending"}>
                      {hodStamp ? hodStamp.name : "Pending"}
                    </span>
                  </div>

                  <div className={`flex flex-col items-center p-2 rounded-lg border border-dashed text-xs ${
                    wardenStamp ? "bg-success-surface/40 border-emerald-200/50" : "bg-secondary-surface/20 border-border-premium"
                  }`}>
                    <CheckCircle className={wardenStamp ? "text-emerald-600 mb-1" : "text-muted-text/30 mb-1"} size={14} />
                    <span className="text-[9px] font-black uppercase tracking-widest leading-none">Warden</span>
                    <span className="text-[8px] font-semibold mt-1 truncate w-full max-w-[85px]" title={wardenStamp ? wardenStamp.name : "Pending"}>
                      {wardenStamp ? wardenStamp.name : "Pending"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3">
                <button
                  onClick={() => setSelectedOutpass(null)}
                  className="w-full btn-premium btn-premium-primary text-xs font-bold rounded-xl py-2.5"
                >
                  Close Window
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

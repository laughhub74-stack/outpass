import React, { useState, useEffect } from "react";
import axios from "axios";
import Login from "./pages/Login";
import StudentDashboard from "./pages/StudentDashboard";
import ApproverDashboard from "./pages/ApproverDashboard";
import SecurityDashboard from "./pages/SecurityDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Toaster, { showErrorToast } from "./components/Toaster";
import { getErrorMessage } from "./utils/errorUtils";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("React ErrorBoundary caught error:", error, errorInfo);
    showErrorToast(error, "The page could not be rendered.");
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#eaedf0] p-6 font-sans">
          <div className="w-full max-w-lg bg-white border border-red-200 rounded-[28px] p-8 shadow-2xl text-left">
            <h2 className="text-xl font-bold text-red-600 mb-2">Rendering Crash Detected</h2>
            <p className="text-xs text-[#4A4A4A] mb-4">
              React crashed while rendering this panel. Here is the traceback for debugging:
            </p>
            <pre className="bg-[#f4f4f4] p-4 rounded-xl text-[11px] text-red-600 font-mono overflow-auto max-h-60 border border-black/5 whitespace-pre-wrap">
              {this.state.error?.toString()}
              {"\n\n"}
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 w-full btn-premium btn-premium-primary text-xs font-bold rounded-xl"
              style={{ height: '42px' }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [role, setRole] = useState(localStorage.getItem("role") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "");
  const [department, setDepartment] = useState(localStorage.getItem("department") || "");

  // Use an explicit deployment URL when configured. For local development,
  // use the browser's host so the API is reachable from another device on
  // the same network instead of always targeting its own loopback address.
  const configuredBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim();
  const apiUrl = (configuredBackendUrl || (
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : window.location.origin
  )).replace(/\/$/, "");
  const handleLoginSuccess = (accessToken, userRole, userName, userDepartment) => {
    setToken(accessToken);
    setRole(userRole);
    setName(userName);
    setDepartment(userDepartment || "");
    localStorage.setItem("token", accessToken);
    localStorage.setItem("role", userRole);
    localStorage.setItem("name", userName);
    localStorage.setItem("department", userDepartment || "");
  };

  const handleLogout = () => {
    setToken("");
    setRole("");
    setName("");
    setDepartment("");
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("name");
    localStorage.removeItem("department");
  };

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        showErrorToast(getErrorMessage(error));
        if (error.response && error.response.status === 401) {
          handleLogout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => {
    const reportUnhandledError = (event) => {
      showErrorToast(event.error || event.reason || event.message);
    };

    window.addEventListener("error", reportUnhandledError);
    window.addEventListener("unhandledrejection", reportUnhandledError);
    return () => {
      window.removeEventListener("error", reportUnhandledError);
      window.removeEventListener("unhandledrejection", reportUnhandledError);
    };
  }, []);

  // Render view based on authentication status and user role
  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} apiUrl={apiUrl} />;
  }

  const renderDashboard = () => {
    switch (role) {
      case "student":
        return (
          <StudentDashboard token={token} userName={name} onLogout={handleLogout} apiUrl={apiUrl} />
        );
      case "advisor":
      case "warden":
      case "hod":
        return (
          <ApproverDashboard
            token={token}
            role={role}
            userName={name}
            onLogout={handleLogout}
            apiUrl={apiUrl}
          />
        );
      case "security":
        return (
          <SecurityDashboard token={token} userName={name} onLogout={handleLogout} apiUrl={apiUrl} />
        );
      case "super_admin":
      case "department_admin":
      case "admin":
        return (
          <AdminDashboard token={token} role={role} department={department} userName={name} onLogout={handleLogout} apiUrl={apiUrl} />
        );
      default:
        return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-bgdark p-4 font-sans text-slate-200">
            <div className="w-full max-w-md bg-navy border border-red-500/30 rounded-xl p-8 shadow-2xl text-center">
              <h1 className="text-2xl font-black text-red-400 mb-4 uppercase">
                Access Restriction
              </h1>
              <p className="text-sm text-gray-300 mb-6">
                Your account role "<strong className="text-white">{role}</strong>" is not recognized by the system.
              </p>
              <button
                onClick={handleLogout}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black tracking-wider text-xs uppercase rounded transition-colors"
              >
                Sign Out / Clear Session
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <Toaster />
      <ErrorBoundary>
        <div className="relative min-h-screen">
          {renderDashboard()}
          <footer className="absolute bottom-4 left-0 right-0 text-center pointer-events-none select-none z-50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-text/50">
              Hostel Outpass Management System
            </p>
          </footer>
        </div>
      </ErrorBoundary>
    </>
  );
}

export default App;

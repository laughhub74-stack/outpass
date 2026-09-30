import React, { useState } from "react";
import axios from "axios";
import { KeyRound, Mail, BadgeInfo, ChevronRight } from "lucide-react";
import { getErrorMessage } from "../utils/errorUtils";
import { useErrorState } from "../components/Toaster";
import PasswordInput from "../components/PasswordInput";

export default function Login({ onLoginSuccess, apiUrl }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const [, setError] = useErrorState();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const loginResponse = await axios.post(`${apiUrl}/api/auth/login`, {
        email: email.trim().toLowerCase(),
        password
      });
      const { access_token, role: userRole, name: userName, department } = loginResponse.data;
      onLoginSuccess(access_token, userRole, userName, department);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err, "Authentication request failed. Please check credentials."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row items-center justify-center premium-bg p-6 font-sans relative">
      {/* Organic Noise Grain Overlay */}
      <div className="absolute inset-0 noise-overlay pointer-events-none z-0" />

      {/* Decorative 2D Background Stickers (Detailed Silhouette Watermarks) */}
      <div className="hidden md:block absolute top-[8%] left-[6%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 120 120" className="w-48 h-48 text-primary-text opacity-[0.07] transform -rotate-6">
          <rect x="5" y="105" width="110" height="4" fill="currentColor"/>
          <rect x="40" y="101" width="40" height="2" fill="currentColor"/>
          <rect x="43" y="97" width="34" height="2" fill="currentColor"/>
          <rect x="46" y="93" width="28" height="4" fill="currentColor"/>
          <rect x="48" y="55" width="24" height="38" fill="currentColor"/>
          <rect x="15" y="65" width="33" height="28" fill="currentColor"/>
          <rect x="72" y="65" width="33" height="28" fill="currentColor"/>
          <polygon points="45,55 75,55 60,40" fill="currentColor"/>
          <rect x="54" y="25" width="12" height="15" fill="currentColor"/>
          <path d="M54 25 C54 15, 66 15, 66 25 Z" fill="currentColor"/>
          <line x1="60" y1="15" x2="60" y2="5" stroke="currentColor" strokeWidth="2"/>
          <rect x="50" y="55" width="2" height="38" fill="#eaedf0"/>
          <rect x="57" y="55" width="2" height="38" fill="#eaedf0"/>
          <rect x="61" y="55" width="2" height="38" fill="#eaedf0"/>
          <rect x="68" y="55" width="2" height="38" fill="#eaedf0"/>
          <rect x="15" y="61" width="33" height="4" fill="currentColor"/>
          <rect x="72" y="61" width="33" height="4" fill="currentColor"/>
          <rect x="19" y="70" width="4" height="6" fill="#eaedf0"/>
          <rect x="27" y="70" width="4" height="6" fill="#eaedf0"/>
          <rect x="35" y="70" width="4" height="6" fill="#eaedf0"/>
          <rect x="19" y="80" width="4" height="6" fill="#eaedf0"/>
          <rect x="27" y="80" width="4" height="6" fill="#eaedf0"/>
          <rect x="35" y="80" width="4" height="6" fill="#eaedf0"/>
          <rect x="81" y="70" width="4" height="6" fill="#eaedf0"/>
          <rect x="89" y="70" width="4" height="6" fill="#eaedf0"/>
          <rect x="97" y="70" width="4" height="6" fill="#eaedf0"/>
          <rect x="81" y="80" width="4" height="6" fill="#eaedf0"/>
          <rect x="89" y="80" width="4" height="6" fill="#eaedf0"/>
          <rect x="97" y="80" width="4" height="6" fill="#eaedf0"/>
          <circle cx="60" cy="48" r="4" fill="#eaedf0"/>
          <circle cx="60" cy="48" r="1.5" fill="currentColor"/>
        </svg>
      </div>

      <div className="hidden md:block absolute bottom-[10%] left-[4%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 120 120" className="w-44 h-44 text-primary-text opacity-[0.07] transform -rotate-12">
          <path d="M10 110 C 30 100, 60 70, 110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none"/>
          <path d="M35 90 C 25 80, 15 85, 10 95 C 15 110, 30 105, 35 90 Z" fill="currentColor"/>
          <path d="M10 95 C 20 95, 28 92, 35 90" stroke="#eaedf0" strokeWidth="0.8" fill="none"/>
          <path d="M50 82 C 60 72, 70 77, 75 87 C 70 102, 55 97, 50 82 Z" fill="currentColor"/>
          <path d="M50 82 C 60 84, 68 86, 75 87" stroke="#eaedf0" strokeWidth="0.8" fill="none"/>
          <path d="M60 62 C 50 52, 40 57, 35 67 C 40 82, 55 77, 60 62 Z" fill="currentColor"/>
          <path d="M35 67 C 45 65, 52 63, 60 62" stroke="#eaedf0" strokeWidth="0.8" fill="none"/>
          <path d="M78 51 C 88 41, 98 46, 103 56 C 98 71, 83 66, 78 51 Z" fill="currentColor"/>
          <path d="M78 51 C 88 53, 96 55, 103 56" stroke="#eaedf0" strokeWidth="0.8" fill="none"/>
          <path d="M88 33 C 78 23, 68 28, 63 38 C 68 53, 83 48, 88 33 Z" fill="currentColor"/>
          <path d="M63 38 C 73 36, 80 34, 88 33" stroke="#eaedf0" strokeWidth="0.8" fill="none"/>
          <path d="M110 10 C 105 25, 95 30, 90 20 C 95 5, 105 5, 110 10 Z" fill="currentColor"/>
          <path d="M90 20 C 98 16, 104 13, 110 10" stroke="#eaedf0" strokeWidth="0.8" fill="none"/>
        </svg>
      </div>

      <div className="hidden md:block absolute top-[6%] right-[8%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 120 120" className="w-48 h-48 text-primary-text opacity-[0.07] transform rotate-12">
          <rect x="5" y="105" width="110" height="4" fill="currentColor"/>
          <rect x="15" y="50" width="90" height="55" fill="currentColor"/>
          <rect x="47" y="70" width="26" height="35" fill="currentColor"/>
          <polygon points="44,70 76,70 60,58" fill="currentColor"/>
          <path d="M54 105 V92 C54 87, 66 87, 66 92 V105 Z" fill="#eaedf0"/>
          <polygon points="12,50 50,50 15,35" fill="currentColor"/>
          <polygon points="108,50 70,50 105,35" fill="currentColor"/>
          <rect x="23" y="60" width="8" height="12" fill="#eaedf0"/>
          <line x1="27" y1="60" x2="27" y2="72" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="23" y1="66" x2="31" y2="66" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="35" y="60" width="8" height="12" fill="#eaedf0"/>
          <line x1="39" y1="60" x2="39" y2="72" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="35" y1="66" x2="43" y2="66" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="23" y="80" width="8" height="12" fill="#eaedf0"/>
          <line x1="27" y1="80" x2="27" y2="92" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="23" y1="86" x2="31" y2="86" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="35" y="80" width="8" height="12" fill="#eaedf0"/>
          <line x1="39" y1="80" x2="39" y2="92" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="35" y1="86" x2="43" y2="86" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="77" y="60" width="8" height="12" fill="#eaedf0"/>
          <line x1="81" y1="60" x2="81" y2="72" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="77" y1="66" x2="85" y2="66" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="89" y="60" width="8" height="12" fill="#eaedf0"/>
          <line x1="93" y1="60" x2="93" y2="72" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="89" y1="66" x2="97" y2="66" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="77" y="80" width="8" height="12" fill="#eaedf0"/>
          <line x1="81" y1="80" x2="81" y2="92" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="77" y1="86" x2="85" y2="86" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="89" y="80" width="8" height="12" fill="#eaedf0"/>
          <line x1="93" y1="80" x2="93" y2="92" stroke="currentColor" strokeWidth="0.8"/>
          <line x1="89" y1="86" x2="97" y2="86" stroke="currentColor" strokeWidth="0.8"/>
          <polygon points="20,44 26,44 23,39" fill="#eaedf0"/>
          <polygon points="94,44 100,44 97,39" fill="#eaedf0"/>
        </svg>
      </div>

      <div className="hidden md:block absolute bottom-[8%] right-[5%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 120 120" className="w-52 h-52 text-primary-text opacity-[0.07] transform rotate-6">
          <rect x="5" y="105" width="110" height="4" fill="currentColor"/>
          <polygon points="10,105 10,60 25,45 25,105" fill="currentColor"/>
          <rect x="13" y="65" width="2" height="4" fill="#eaedf0"/>
          <rect x="19" y="65" width="2" height="4" fill="#eaedf0"/>
          <rect x="13" y="75" width="2" height="4" fill="#eaedf0"/>
          <rect x="19" y="75" width="2" height="4" fill="#eaedf0"/>
          <rect x="13" y="85" width="2" height="4" fill="#eaedf0"/>
          <rect x="19" y="85" width="2" height="4" fill="#eaedf0"/>
          <rect x="13" y="95" width="2" height="4" fill="#eaedf0"/>
          <rect x="19" y="95" width="2" height="4" fill="#eaedf0"/>
          <rect x="28" y="30" width="20" height="75" fill="currentColor"/>
          <line x1="38" y1="30" x2="38" y2="10" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="38" cy="10" r="1.5" fill="currentColor"/>
          <rect x="32" y="38" width="3" height="5" fill="#eaedf0"/>
          <rect x="41" y="38" width="3" height="5" fill="#eaedf0"/>
          <rect x="32" y="48" width="3" height="5" fill="#eaedf0"/>
          <rect x="41" y="48" width="3" height="5" fill="#eaedf0"/>
          <rect x="32" y="58" width="3" height="5" fill="#eaedf0"/>
          <rect x="41" y="58" width="3" height="5" fill="#eaedf0"/>
          <rect x="32" y="68" width="3" height="5" fill="#eaedf0"/>
          <rect x="41" y="68" width="3" height="5" fill="#eaedf0"/>
          <rect x="32" y="78" width="3" height="5" fill="#eaedf0"/>
          <rect x="41" y="78" width="3" height="5" fill="#eaedf0"/>
          <rect x="32" y="88" width="3" height="5" fill="#eaedf0"/>
          <rect x="41" y="88" width="3" height="5" fill="#eaedf0"/>
          <polygon points="52,105 52,50 62,50 62,40 72,40 72,105" fill="currentColor"/>
          <rect x="56" y="58" width="2" height="6" fill="#eaedf0"/>
          <rect x="66" y="58" width="2" height="6" fill="#eaedf0"/>
          <rect x="56" y="68" width="2" height="6" fill="#eaedf0"/>
          <rect x="66" y="68" width="2" height="6" fill="#eaedf0"/>
          <rect x="56" y="78" width="2" height="6" fill="#eaedf0"/>
          <rect x="66" y="78" width="2" height="6" fill="#eaedf0"/>
          <rect x="56" y="88" width="2" height="6" fill="#eaedf0"/>
          <rect x="66" y="88" width="2" height="6" fill="#eaedf0"/>
          <rect x="76" y="70" width="24" height="35" fill="currentColor"/>
          <polygon points="73,70 103,70 88,58" fill="currentColor"/>
          <circle cx="88" cy="65" r="2.5" fill="#eaedf0"/>
          <rect x="80" y="77" width="4" height="6" fill="#eaedf0"/>
          <rect x="90" y="77" width="4" height="6" fill="#eaedf0"/>
          <rect x="80" y="89" width="4" height="6" fill="#eaedf0"/>
          <rect x="90" y="89" width="4" height="6" fill="#eaedf0"/>
          <path d="M 12 105 L 14 100 L 16 105 Z" fill="currentColor"/>
          <path d="M 49 105 L 51 98 L 53 105 Z" fill="currentColor"/>
          <path d="M 104 105 C 104 100, 108 100, 108 105 Z" fill="currentColor"/>
        </svg>
      </div>

      {/* Additional Campus Watermark Elements (Students, Books, Caps) */}
      {/* Left Center: Student Walking with Backpack */}
      <div className="hidden md:block absolute top-[44%] left-[2%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 120 120" className="w-36 h-36 text-primary-text opacity-[0.07] transform rotate-6">
          <circle cx="50" cy="20" r="8" fill="currentColor"/>
          <path d="M42,29 C35,32 35,45 35,65 L44,65 L44,98 C44,101 48,101 48,98 L48,70 L54,70 L54,98 C54,101 58,101 58,98 L58,65 L67,65 C67,45 67,32 60,29 Z" fill="currentColor"/>
          <path d="M34,35 C28,36 26,42 26,50 C26,58 28,62 34,63 Z" fill="currentColor"/>
          <path d="M60,35 L68,48 L62,54 L55,42" fill="currentColor"/>
          <path d="M64,46 L76,46 L76,56 L64,56 Z" fill="#eaedf0"/>
          <rect x="66" y="48" width="8" height="6" fill="currentColor"/>
        </svg>
      </div>

      {/* Right Center: Two Students Walking & Studying */}
      <div className="hidden md:block absolute top-[38%] right-[2%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 150 120" className="w-48 h-48 text-primary-text opacity-[0.07] transform -rotate-3">
          <circle cx="45" cy="25" r="7.5" fill="currentColor"/>
          <path d="M38,34 C32,36 32,48 32,66 L40,66 L40,96 C40,99 44,99 44,96 L44,70 L48,70 L48,96 C48,99 52,99 52,96 L52,66 C52,66 57,64 57,61 L53,42" fill="currentColor"/>
          <path d="M32,40 C27,41 25,46 25,53 C25,60 27,63 32,64 Z" fill="currentColor"/>
          <circle cx="85" cy="22" r="7" fill="currentColor"/>
          <path d="M78,31 C72,33 72,44 72,62 L78,62 L78,92 C78,95 82,95 82,92 L82,67 L86,67 L86,92 C86,95 90,95 90,92 L90,62 L98,62 C98,44 98,33 92,31 Z" fill="currentColor"/>
          <path d="M72,31 Q85,45 92,60" stroke="currentColor" strokeWidth="2" fill="none"/>
          <rect x="88" y="55" width="10" height="12" rx="2" fill="currentColor"/>
        </svg>
      </div>

      {/* Bottom Left: Graduation Cap & Diploma Scroll */}
      <div className="hidden md:block absolute bottom-[8%] left-[22%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 100 100" className="w-24 h-24 text-primary-text opacity-[0.06] transform -rotate-12">
          <polygon points="10,35 50,15 90,35 50,55" fill="currentColor"/>
          <path d="M30,46 v12 c0,6 10,8 20,8 s20-2 20-8 v-12" fill="currentColor"/>
          <path d="M50,35 L80,48 V58" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <rect x="78" y="58" width="4" height="6" fill="currentColor"/>
          <g transform="rotate(15 25 75)">
            <rect x="25" y="75" width="25" height="6" rx="2" fill="currentColor"/>
            <rect x="35" y="73" width="4" height="10" fill="#eaedf0"/>
          </g>
        </svg>
      </div>

      {/* Top Right: Stack of Books */}
      <div className="hidden md:block absolute top-[10%] right-[32%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 100 100" className="w-20 h-20 text-primary-text opacity-[0.06] transform rotate-12">
          <rect x="15" y="65" width="70" height="15" rx="3" fill="currentColor"/>
          <rect x="18" y="68" width="64" height="2" fill="#eaedf0"/>
          <path d="M80,65 V80" stroke="#eaedf0" strokeWidth="2"/>
          <rect x="25" y="48" width="60" height="14" rx="3" fill="currentColor"/>
          <rect x="28" y="51" width="54" height="2" fill="#eaedf0"/>
          <path d="M80,48 V62" stroke="#eaedf0" strokeWidth="2"/>
          <g transform="rotate(-8 30 35)">
            <rect x="30" y="32" width="55" height="13" rx="2" fill="currentColor"/>
            <rect x="33" y="35" width="49" height="2" fill="#eaedf0"/>
            <path d="M80,32 V45" stroke="#eaedf0" strokeWidth="2"/>
          </g>
        </svg>
      </div>

      {/* Floating Birds in Sky (Top Left Campus Sky area) */}
      <div className="hidden md:block absolute top-[4%] left-[24%] select-none pointer-events-none z-0">
        <svg viewBox="0 0 100 100" className="w-24 h-24 text-primary-text opacity-[0.05]">
          <path d="M10,20 Q15,15 20,20 Q25,15 30,20 Q20,24 10,20 Z" fill="currentColor"/>
          <path d="M40,35 Q43,31 46,35 Q49,31 52,35 Q46,38 40,35 Z" fill="currentColor"/>
          <path d="M25,50 Q28,47 31,50 Q34,47 37,50 Q31,53 25,50 Z" fill="currentColor"/>
        </svg>
      </div>

      {/* Main Container */}
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-center z-10 my-auto">
        
        {/* Left Side: Brand presentation */}
        <div className="lg:col-span-6 space-y-4 sm:space-y-6 text-center lg:text-left pr-0 lg:pr-8">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-primary-text leading-tight">
            H.O.M.S
          </h1>
          <div className="space-y-1">
            <p className="text-lg sm:text-xl font-medium text-secondary-text leading-relaxed">
              Hostel Outpass Management System
            </p>
         
          </div>
        </div>

        {/* Right Side: Login card & Quick login helper */}
        <div className="lg:col-span-6 space-y-4 sm:space-y-6 w-full max-w-md mx-auto lg:max-w-none">
          <div className="card-premium p-6 sm:p-8 bg-pure-white w-full">
            <div className="mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-text mb-1">Welcome back</h2>
              <p className="text-xs sm:text-sm text-secondary-text">Enter your credentials to access your portal</p>
            </div>

            {message && (
              <div className="mb-4 flex items-center gap-2 p-3.5 bg-success-surface border border-emerald-200/50 text-emerald-800 text-xs sm:text-sm rounded-2xl">
                <BadgeInfo size={18} className="text-emerald-600 shrink-0" />
                <span className="font-medium">{message}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-secondary-text mb-1.5 ml-1 uppercase tracking-wider">Email Address</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
                  <input
                    type="email"
                    required
                    placeholder="name@college.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-premium input-premium-icon"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-secondary-text mb-1.5 ml-1 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-text" />
                  <PasswordInput
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-premium input-premium-icon"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-premium btn-premium-primary mt-6 text-sm relative"
              >
                {loading ? (
                  <div className="flex items-center gap-2 justify-center">
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Processing Securely...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 justify-center">
                    <span>Access Account</span>
                    <ChevronRight size={16} />
                  </div>
                )}
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}

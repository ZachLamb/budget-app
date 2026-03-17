import axios from "axios";

function getServerBaseURL(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api`;
}

const api = axios.create({
  baseURL: "",
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  // Evaluate at request time so client requests always use relative /api (never backend:8000).
  if (typeof window !== "undefined") {
    config.baseURL = "";
    const p = (config.url || "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+/g, "/") || "/";
    config.url = p.startsWith("/api") ? p : `/api${p.startsWith("/") ? p : `/${p}`}`;
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } else {
    config.baseURL = getServerBaseURL();
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    // Surface the server's detail message so toast/error handlers show something useful
    if (err.code === "ECONNABORTED" || err.code === "ERR_CANCELED") {
      err.message = "Request timed out. Please try again.";
    } else if (err.response?.data?.detail) {
      const detail = err.response.data.detail;
      err.message = typeof detail === "string" ? detail : JSON.stringify(detail);
    }
    return Promise.reject(err);
  }
);

export default api;

import api from "./client";

export interface User {
  id: string;
  email: string;
  name: string;
  household_id: string;
  role: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export const authApi = {
  register: (data: { email: string; name: string; password: string; household_name?: string }) =>
    api.post<TokenResponse>("/auth/register", data).then((r) => r.data),
  login: (data: { email: string; password: string }) =>
    api.post<TokenResponse>("/auth/login", data).then((r) => r.data),
  me: () => api.get<User>("/auth/me").then((r) => r.data),
};

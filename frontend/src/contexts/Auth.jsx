import { createContext, useContext, useState, useEffect } from "react";
import { api, setCsrf, setTimezone } from "../services/api";
const Auth = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .get("/auth/me")
      .then(({ data }) => {
        setTimezone(data.timezone);
        setUser(data.user);
        setCsrf(data.csrf);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const login = async (email, senha) => {
    const { data } = await api.post("/auth/login", { email, senha });
    setTimezone(data.timezone);
    setUser(data.user);
    setCsrf(data.csrf);
  };
  const logout = async () => {
    await api.post("/auth/logout");
    setCsrf(null);
    setUser(null);
  };
  return (
    <Auth.Provider value={{ user, loading, login, logout }}>
      {children}
    </Auth.Provider>
  );
}
export const useAuth = () => useContext(Auth);

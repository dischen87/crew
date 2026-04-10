import { Outlet } from "@tanstack/react-router";
import { AuthProvider } from "../contexts/AuthContext";

/**
 * Root layout — wraps the entire app with context providers.
 * The Outlet renders the matched child route.
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { usePermissions, type Permissions } from "@/hooks/usePermissions";

// Páginas críticas (carregadas imediatamente)
import Auth from "./pages/Auth";
import { getPostLoginPath } from "@/lib/oauthResume";
import Index from "./pages/Index";

// Code splitting: páginas carregadas sob demanda (reduz bundle inicial)
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const FirstAccess = lazy(() => import("./pages/FirstAccess"));
const Shipments = lazy(() => import("./pages/Shipments"));
const Quotes = lazy(() => import("./pages/Quotes"));
const Registrations = lazy(() => import("./pages/Registrations"));
const FinancialProcess = lazy(() => import("./pages/FinancialProcess"));
const FinancialCompany = lazy(() => import("./pages/FinancialCompany"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const MyAccount = lazy(() => import("./pages/MyAccount"));
const SuperAdmin = lazy(() => import("./pages/SuperAdmin"));
const WhatsAppAdmin = lazy(() => import("./pages/WhatsAppAdmin"));
const NotFound = lazy(() => import("./pages/NotFound"));
const QuotePrintView = lazy(() => import("./components/quotes/QuotePrintView"));
const Tracking = lazy(() => import("./pages/Tracking"));
const TrackingV2 = lazy(() => import("./pages/TrackingV2"));
const TrackingV3 = lazy(() => import("./pages/TrackingV3"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Landing = lazy(() => import("./pages/Landing"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Signup = lazy(() => import("./pages/Signup"));
const CheckoutReturn = lazy(() => import("./pages/CheckoutReturn"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const DemoLogin = lazy(() => import("./pages/DemoLogin"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000, // 3 minutes — reduces redundant refetches and Cloud costs
      refetchOnWindowFocus: false,
    },
  },
});

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-background">
    <div className="animate-pulse text-muted-foreground">Loading...</div>
  </div>
);

function ProtectedRoute({
  children,
  requiredPermission,
}: {
  children: React.ReactNode;
  requiredPermission?: keyof Permissions;
}) {
  const { user, profile, loading } = useAuth();
  const permissions = usePermissions();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/" replace />;

  // Force password change on first access
  if (profile?.must_change_password) return <Navigate to="/first-access" replace />;

  // Check permission if specified
  if (requiredPermission && !permissions[requiredPermission]) {
    return <Navigate to="/" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

/** Superadmin-only route WITHOUT AppLayout (fullscreen admin panel) */
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isSuperadmin } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/" replace />;
  if (profile?.must_change_password) return <Navigate to="/first-access" replace />;
  if (!isSuperadmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** Redirect superadmin (when not inside a company) from "/" to "/admin" */
function DashboardRoute() {
  const { isSuperadmin, activeCompanyId } = useAuth();

  if (isSuperadmin && !activeCompanyId) {
    return <Navigate to="/admin" replace />;
  }

  return <ProtectedRoute><Index /></ProtectedRoute>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/first-access" element={<FirstAccess />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/quotes/:quoteId/print" element={<QuotePrintView />} />
        <Route path="/tracking/:clientCnpj" element={<Tracking />} />
        <Route path="/tracking-v2/:clientCnpj" element={<TrackingV2 />} />
        <Route path="/tracking-v3/:clientCnpj" element={<TrackingV3 />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/precos" element={<Pricing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/checkout/return" element={<CheckoutReturn />} />
        <Route path="/termos" element={<TermsOfUse />} />
        <Route path="/privacidade" element={<PrivacyPolicy />} />
        <Route path="/demo" element={<DemoLogin />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/" element={user && !loading ? <Navigate to={getPostLoginPath()} replace /> : <Auth />} />
        <Route path="/dashboard" element={<DashboardRoute />} />
        <Route path="/shipments" element={<ProtectedRoute requiredPermission="canAccessShipments"><Shipments /></ProtectedRoute>} />
        <Route path="/quotes" element={<ProtectedRoute requiredPermission="canAccessQuotes"><Quotes /></ProtectedRoute>} />
        <Route path="/registrations" element={<ProtectedRoute requiredPermission="canAccessRegistrations"><Registrations /></ProtectedRoute>} />
        <Route path="/financial" element={<Navigate to="/financial/empresa" replace />} />
        <Route path="/financial/processo" element={<ProtectedRoute requiredPermission="canAccessFinancial"><FinancialProcess /></ProtectedRoute>} />
        <Route path="/financial/empresa" element={<ProtectedRoute requiredPermission="canAccessFinancial"><FinancialCompany /></ProtectedRoute>} />
        <Route path="/overhead" element={<Navigate to="/financial/processo?tab=geral" replace />} />
        <Route path="/settings" element={<ProtectedRoute requiredPermission="canAccessSettings"><SettingsPage /></ProtectedRoute>} />
        <Route path="/account" element={<ProtectedRoute><MyAccount /></ProtectedRoute>} />
        <Route path="/billing" element={<Navigate to="/settings#assinatura" replace />} />
        <Route path="/admin" element={<SuperAdminRoute><SuperAdmin /></SuperAdminRoute>} />
        <Route path="/admin/whatsapp" element={<SuperAdminRoute><WhatsAppAdmin /></SuperAdminRoute>} />
        {/* Redirect old routes */}
        <Route path="/clients" element={<Navigate to="/registrations" replace />} />
        <Route path="/documents" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;

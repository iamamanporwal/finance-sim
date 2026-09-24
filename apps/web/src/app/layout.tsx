import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { theme } from "@/theme/theme";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const roboto = Roboto({ weight: ["300", "400", "500", "700"], subsets: ["latin"], display: "swap", variable: "--font-roboto" });

export const metadata: Metadata = {
  title: "Visual Financial Simulator",
  description: "Build your business model like a workflow. Run the business forward in time. See what happens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

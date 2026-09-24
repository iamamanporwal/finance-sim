import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

/** Static marketing page — does not load the engine, canvas or charts. */
export default function LandingPage() {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2 }}>
      <Stack spacing={3} sx={{ maxWidth: 640, textAlign: "center", alignItems: "center" }}>
        <Typography variant="h1">Build your business model like a workflow.</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 17 }}>
          Connect assumptions together. Run the business forward in time. See what happens — and why.
        </Typography>
        <Box component="pre" sx={{ m: 0, color: "text.secondary", fontSize: 13, lineHeight: 1.6 }}>
          {"Signups → Conversion → Customers → Revenue → Cash"}
        </Box>
        <Button component={Link} href="/app" variant="contained" size="large">
          Open the simulator
        </Button>
      </Stack>
    </Box>
  );
}

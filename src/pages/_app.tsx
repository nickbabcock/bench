import type { AppProps } from "next/app";
import "sanitize.css";
import "sanitize.css/forms.css";
import "sanitize.css/typography.css";
import "sanitize.css/assets.css";
import "sanitize.css/system-ui.css";
import "../styles/globals.css";

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

export default MyApp;

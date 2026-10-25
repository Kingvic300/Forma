import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/mona-sans";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/caveat/600.css";
import "@fontsource/allura";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

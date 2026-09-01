import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("#root element was not found");
}

hydrateRoot(
  root,
  <StrictMode>
    <App />
  </StrictMode>,
);

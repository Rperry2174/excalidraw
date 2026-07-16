import { DefaultSidebar, Sidebar, THEME } from "@excalidraw/excalidraw";
import {
  messageCircleIcon,
  presentationIcon,
  searchIcon,
} from "@excalidraw/excalidraw/components/icons";
import { LinkButton } from "@excalidraw/excalidraw/components/LinkButton";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { ShapeFinderPanel } from "./ShapeFinder/ShapeFinderPanel";

import "./AppSidebar.scss";

export const AppSidebar = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const { theme, openSidebar } = useUIAppState();
  const shapeFinderUrl = import.meta.env.VITE_APP_SHAPE_FINDER_URL;
  const shapeFinder =
    shapeFinderUrl && excalidrawAPI
      ? { apiBaseUrl: shapeFinderUrl, excalidrawAPI }
      : null;

  return (
    <DefaultSidebar>
      <DefaultSidebar.TabTriggers>
        {shapeFinder && (
          <Sidebar.TabTrigger
            tab="shapeFinder"
            aria-label="Shape Finder"
            title="Shape Finder"
            style={{
              opacity: openSidebar?.tab === "shapeFinder" ? 1 : 0.4,
            }}
          >
            {searchIcon}
          </Sidebar.TabTrigger>
        )}
        <Sidebar.TabTrigger
          tab="comments"
          style={{ opacity: openSidebar?.tab === "comments" ? 1 : 0.4 }}
        >
          {messageCircleIcon}
        </Sidebar.TabTrigger>
        <Sidebar.TabTrigger
          tab="presentation"
          style={{ opacity: openSidebar?.tab === "presentation" ? 1 : 0.4 }}
        >
          {presentationIcon}
        </Sidebar.TabTrigger>
      </DefaultSidebar.TabTriggers>
      {shapeFinder && (
        <Sidebar.Tab tab="shapeFinder" className="shape-finder-tab">
          <ShapeFinderPanel
            excalidrawAPI={shapeFinder.excalidrawAPI}
            apiBaseUrl={shapeFinder.apiBaseUrl}
          />
        </Sidebar.Tab>
      )}
      <Sidebar.Tab tab="comments">
        <div className="app-sidebar-promo-container">
          <div
            className="app-sidebar-promo-image"
            style={{
              ["--image-source" as any]: `url(/oss_promo_comments_${
                theme === THEME.DARK ? "dark" : "light"
              }.jpg)`,
              opacity: 0.7,
            }}
          />
          <div className="app-sidebar-promo-text">
            Make comments with Excalidraw+
          </div>
          <LinkButton
            href={`${
              import.meta.env.VITE_APP_PLUS_LP
            }/plus?utm_source=excalidraw&utm_medium=app&utm_content=comments_promo#excalidraw-redirect`}
          >
            Sign up now
          </LinkButton>
        </div>
      </Sidebar.Tab>
      <Sidebar.Tab tab="presentation" className="px-3">
        <div className="app-sidebar-promo-container">
          <div
            className="app-sidebar-promo-image"
            style={{
              ["--image-source" as any]: `url(/oss_promo_presentations_${
                theme === THEME.DARK ? "dark" : "light"
              }.svg)`,
              backgroundSize: "60%",
              opacity: 0.4,
            }}
          />
          <div className="app-sidebar-promo-text">
            Create presentations with Excalidraw+
          </div>
          <LinkButton
            href={`${
              import.meta.env.VITE_APP_PLUS_LP
            }/plus?utm_source=excalidraw&utm_medium=app&utm_content=presentations_promo#excalidraw-redirect`}
          >
            Sign up now
          </LinkButton>
        </div>
      </Sidebar.Tab>
    </DefaultSidebar>
  );
};

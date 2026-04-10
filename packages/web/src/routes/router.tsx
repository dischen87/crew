import { createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
import RootLayout from "./RootLayout";
import EventLayout from "./EventLayout";
import Landing from "../pages/Landing";
import Login from "../pages/Login";
import Home from "../pages/Home";
import Golf from "../pages/Golf";
import Leaderboard from "../pages/Leaderboard";
import Chat from "../pages/Chat";
import Photos from "../pages/Photos";
import More from "../pages/More";

// ---- Root ----
const rootRoute = createRootRoute({
  component: RootLayout,
});

// ---- Public routes (auth redirects handled inside components) ----
const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join/$code",
  component: Login,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: Login,
});

// ---- Event layout (auth guard inside EventLayout) ----
const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$eventId",
  component: EventLayout,
});

const eventHomeRoute = createRoute({
  getParentRoute: () => eventRoute,
  path: "/",
  component: Home,
});

const eventGolfRoute = createRoute({
  getParentRoute: () => eventRoute,
  path: "/golf",
  component: Golf,
});

const eventGolfRoundRoute = createRoute({
  getParentRoute: () => eventRoute,
  path: "/golf/$roundId",
  component: Golf,
});

const eventRankingRoute = createRoute({
  getParentRoute: () => eventRoute,
  path: "/ranking",
  component: Leaderboard,
});

const eventChatRoute = createRoute({
  getParentRoute: () => eventRoute,
  path: "/chat",
  component: Chat,
});

const eventPhotosRoute = createRoute({
  getParentRoute: () => eventRoute,
  path: "/photos",
  component: Photos,
});

const eventMoreRoute = createRoute({
  getParentRoute: () => eventRoute,
  path: "/more",
  component: More,
});

// ---- Route tree ----
const routeTree = rootRoute.addChildren([
  landingRoute,
  joinRoute,
  loginRoute,
  eventRoute.addChildren([
    eventHomeRoute,
    eventGolfRoute,
    eventGolfRoundRoute,
    eventRankingRoute,
    eventChatRoute,
    eventPhotosRoute,
    eventMoreRoute,
  ]),
]);

// ---- Router instance ----
export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// Type registration
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { MarketProvider } from "./lib/market";
import { Home } from "./pages/Home";
import { Jobs } from "./pages/Jobs";
import { JobDetail } from "./pages/JobDetail";
import { Agents, AgentProfile } from "./pages/Agents";
import { CreateJob } from "./pages/CreateJob";
import { ConnectAgent, MyJobs, NotFound, RegisterAgent } from "./pages/AccountPages";
import { DidStudio } from "./pages/DidStudio";
import { Guide } from "./pages/Guide";
import { ComputeMarketProvider } from "./lib/compute-market";
import {
  ComputeDetail,
  ComputeMarketplace,
  CreateComputeRequest,
  ProviderConsole,
  Providers,
} from "./pages/ComputePages";

export function App() {
  return (
    <MarketProvider>
      <ComputeMarketProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="create" element={<CreateJob />} />
            <Route path="my-jobs" element={<MyJobs />} />
            <Route path="agents" element={<Agents />} />
            <Route path="agents/:wallet" element={<AgentProfile />} />
            <Route path="register-agent" element={<RegisterAgent />} />
            <Route path="connect-agent" element={<ConnectAgent />} />
            <Route path="did-studio" element={<DidStudio />} />
            <Route path="guide" element={<Guide />} />
            <Route path="compute" element={<ComputeMarketplace />} />
            <Route path="compute/new" element={<CreateComputeRequest />} />
            <Route path="compute/:id" element={<ComputeDetail />} />
            <Route path="providers" element={<Providers />} />
            <Route path="provider-console" element={<ProviderConsole />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ComputeMarketProvider>
    </MarketProvider>
  );
}

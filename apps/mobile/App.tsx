import { AppProviders } from './src/app/AppProviders';

export default function App({ runtimeConfig }: { runtimeConfig?: unknown }) {
  return <AppProviders runtimeConfig={runtimeConfig} />;
}

import { Route } from 'react-router-dom';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { ru } from '../i18n/ru';

const n = ru.nav.items;

/** Каталог: tracks and releases (step 3.6), pseudonyms (step 3.8); owners live in routes/owners.tsx. */
export const catalogRoutes = [
  <Route key="tracks" path="tracks" element={<PlaceholderPage title={n.tracks} step="3.6" />} />,
  <Route key="track" path="tracks/:isrc" element={<PlaceholderPage title={n.tracks} step="3.6" />} />,
  <Route key="releases" path="releases" element={<PlaceholderPage title={n.releases} step="3.6" />} />,
  <Route key="release" path="releases/:upc" element={<PlaceholderPage title={n.releases} step="3.6" />} />,
  <Route key="artists" path="artists" element={<PlaceholderPage title={n.artists} step="3.8" />} />,
  <Route key="artist-duplicates" path="artists/duplicates" element={<PlaceholderPage title={n.artists} step="3.8" />} />,
  <Route key="artist" path="artists/:id" element={<PlaceholderPage title={n.artists} step="3.8" />} />,
];

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import AutoProducer from './AutoProducer.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AutoProducer />} />
        <Route path="/auto-producer" element={<AutoProducer />} />
        <Route path="/admin" element={<AutoProducer />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

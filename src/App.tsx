import './App.css'

const MOCKUPS = [
  { id: 'tshirt', label: 'Remera', src: '/mockups/tshirt.svg' },
  { id: 'hoodie', label: 'Hoodie', src: '/mockups/hoodie.svg' },
  { id: 'pants',  label: 'Pantalon', src: '/mockups/pants.svg' },
]

function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">RAW</div>
        <div className="section-title">Prendas</div>
        {MOCKUPS.map(m => (
          <div key={m.id} className="mockup-thumb">
            <img src={m.src} alt={m.label} />
            <span>{m.label}</span>
          </div>
        ))}
      </aside>
      <main className="canvas-area">
        <p className="placeholder">Selecciona una prenda para empezar</p>
      </main>
    </div>
  )
}

export default App

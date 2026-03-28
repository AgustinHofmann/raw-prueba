import { useState } from 'react'
import { Project } from '../types/project'
import './NewProjectModal.css'

interface Props {
  onConfirm: (project: Project) => void
  onCancel: () => void
}

const MOCKUPS = [
  { id: 'tshirt' as const, label: 'Remera', src: '/mockups/tshirt.svg' },
  { id: 'hoodie' as const, label: 'Hoodie', src: '/mockups/hoodie.svg' },
  { id: 'pants'  as const, label: 'Pantalon', src: '/mockups/pants.svg' },
]

export default function NewProjectModal({ onConfirm, onCancel }: Props) {
  const [name, setName] = useState('Sin titulo')
  const [selectedMockup, setSelectedMockup] = useState<'tshirt' | 'hoodie' | 'pants'>('tshirt')

  function handleCreate() {
    const now = Date.now()
    onConfirm({
      id: crypto.randomUUID(),
      name: name.trim() || 'Sin titulo',
      mockupId: selectedMockup,
      thumbnail: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Nuevo proyecto</h3>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="modal-body">
          <label className="modal-label">Nombre</label>
          <input
            className="modal-input"
            value={name}
            onChange={e => setName(e.target.value)}
            onFocus={e => e.target.select()}
            autoFocus
          />

          <label className="modal-label" style={{ marginTop: 20 }}>Prenda</label>
          <div className="modal-mockup-grid">
            {MOCKUPS.map(m => (
              <div
                key={m.id}
                className={`modal-mockup-item ${selectedMockup === m.id ? 'selected' : ''}`}
                onClick={() => setSelectedMockup(m.id)}
              >
                <img src={m.src} alt={m.label} />
                <span>{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn-cancel" onClick={onCancel}>Cancelar</button>
          <button className="modal-btn-create" onClick={handleCreate}>Crear</button>
        </div>
      </div>
    </div>
  )
}

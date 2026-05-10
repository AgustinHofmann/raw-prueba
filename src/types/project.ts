export interface Project {
  id: string
  name: string
  mockupId: 'tshirt' | 'hoodie' | 'pants'
  thumbnail: string | null
  canvasJson: string | null
  colors: string[]
  tag: string
  folderId: string | null
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  createdAt: number
}

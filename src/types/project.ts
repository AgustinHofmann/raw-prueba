export interface Project {
  id: string
  name: string
  mockupId: 'tshirt' | 'hoodie' | 'pants'
  thumbnail: string | null  // base64
  createdAt: number
  updatedAt: number
}

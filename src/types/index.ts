export interface UserPayload {
  id: string
  email: string
  name: string
}

export interface SignupBody {
  name: string
  email: string
  password: string
}

export interface SigninBody {
  email: string
  password: string
}

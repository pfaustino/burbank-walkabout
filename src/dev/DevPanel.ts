export function mountDevPanel(input: {
  landmarks: { name: string; x: number; z: number }[]
  people: { id: string; name: string }[]
  teleport: (x: number, z: number) => void
  meet: (id: string) => void
}): void {
  const root = document.querySelector('#dev-panel')
  if (!(root instanceof HTMLElement)) return
  root.hidden = false
  root.replaceChildren()

  const title = document.createElement('p')
  title.textContent = 'dev'
  root.append(title)

  for (const landmark of input.landmarks) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = landmark.name
    button.addEventListener('click', () => {
      input.teleport(landmark.x, landmark.z)
      button.blur()
    })
    root.append(button)
  }
  for (const person of input.people) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `Meet ${person.name}`
    button.addEventListener('click', () => {
      input.meet(person.id)
      button.blur()
    })
    root.append(button)
  }
}

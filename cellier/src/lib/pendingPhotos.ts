/** Photos prises depuis le bouton Ajouter de la barre d'onglets, en transit vers l'écran Ajouter. */
let pending: File[] = []
export const setPendingPhotos = (f: File[]) => { pending = f }
export const takePendingPhotos = () => {
  const f = pending
  pending = []
  return f
}

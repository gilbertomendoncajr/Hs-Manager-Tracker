// Preferência "Reduzir animações": marca <html data-reduce-motion="1"> e sincroniza entre janelas.
// O CSS também respeita prefers-reduced-motion do sistema; esta chave é o ajuste manual do app.
;(function () {
  const KEY = 'hsdl.reduceMotion'
  function read() { try { return localStorage.getItem(KEY) === '1' } catch (_) { return false } }
  function apply(on) {
    if (on) document.documentElement.setAttribute('data-reduce-motion', '1')
    else document.documentElement.removeAttribute('data-reduce-motion')
  }
  window.setReduceMotion = function (on) {
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch (_) {}
    apply(on)
  }
  window.getReduceMotion = read
  apply(read())
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(e.newValue === '1') })
})()

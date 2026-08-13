class Base {}
protocol Store {}
class Settings {}
class Request {}

@available(*, deprecated)
class Engine: Base, Store {
  var settings: Settings
  init(settings: Settings) { self.settings = settings }
  
  @available(*, deprecated)
  func run(req: Request) -> Settings {
    let _ = try? String(contentsOfFile: "config/app.json")
    return Settings()
  }
}

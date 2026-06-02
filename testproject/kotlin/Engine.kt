package testproject.kotlin

import java.io.File

annotation class Route

open class Base {}
interface Store {}
class Settings {}
class Request {}

@Route
class Engine : Base(), Store {
  val settings: Settings = Settings()
  
  @Route
  fun run(req: Request): Settings {
    val cfg = File("config/app.json").readText()
    return Settings()
  }
}

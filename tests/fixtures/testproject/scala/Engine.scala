package testproject.scala

import scala.io.Source

trait Store {}
class Base {}
class Settings {}
class Request {}

@deprecated
class Engine extends Base with Store {
  val settings: Settings = new Settings()
  
  @deprecated
  def run(req: Request): Settings = {
    val cfg = Source.fromFile("config/app.json")
    new Settings()
  }
}

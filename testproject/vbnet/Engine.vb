Imports System.IO

Interface Store
End Interface

Class Base
End Class

Class Settings
End Class

Class Request
End Class

<Serializable>
Public Class Engine
  Inherits Base
  Implements Store
  Private settings As Settings
  
  <Obsolete>
  Public Function Run(req As Request) As Settings
    Dim cfg = File.ReadAllText("config/app.json")
    Return New Settings()
  End Function
End Class

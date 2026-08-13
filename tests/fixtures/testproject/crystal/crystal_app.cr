require "./crystal_lib"

class CrystalApp
  def start
    lib = CrystalLib.new
    lib.crystal_perform
  end
end

include("julia_lib.jl")

struct JuliaApp
  value::Int
end

function execute(app::JuliaApp)
  helper_function(app.value)
end

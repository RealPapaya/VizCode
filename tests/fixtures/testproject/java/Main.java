package testproject.java;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

public class Main {
    public static void main(String[] args) {
        // [type_usage] AdvancedModel is a project internal type
        AdvancedModel model = new AdvancedModel();
        model.process();

        // [asset_ref / config_ref] literal strings referencing local files
        File configFile = new File("config.json");
        String template = Files.readString(Path.of("index.html"));
        String yamlConfig = Files.readString(Path.of("application.yaml"));

        processItems(model);
    }

    // [type_usage] BaseModel used in fn parameters
    public static void processItems(BaseModel item) {
        System.out.println("Processing item");
    }
}

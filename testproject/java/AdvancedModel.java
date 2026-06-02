package testproject.java;

public class AdvancedModel extends BaseModel implements Processable {
    public void process() {
        System.out.println("Processing AdvancedModel with ID: " + this.id);
    }
}
